package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/jtdevloper/enteroshlc/pkg/models"
)

// Make sure Datasource implements required interfaces. This is important to do
// since otherwise we will only get a not implemented error response from plugin in
// runtime. In this example datasource instance implements backend.QueryDataHandler,
// backend.CheckHealthHandler interfaces. Plugin should not implement all these
// interfaces - only those which are required for a particular task.
var (
	_ backend.QueryDataHandler      = (*Datasource)(nil)
	_ backend.CheckHealthHandler    = (*Datasource)(nil)
	_ backend.CallResourceHandler   = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
)

// NewDatasource creates a new datasource instance.
func NewDatasource(_ context.Context, _ backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	return &Datasource{}, nil
}

// Datasource is an example datasource which can respond to data queries, reports
// its health and has streaming skills.
type Datasource struct{}

type queryModel struct {
	QueryType   string `json:"queryType,omitempty"`
	Target      string `json:"target"`
	Capture     string `json:"capture"`
	Metric      string `json:"metric"`
	Measurement string `json:"measurement"`
	SpikeOnly   bool   `json:"spikeOnly"`

	// Heatmap-mode fields. Active only when QueryType == "heatmap".
	// Two sub-modes are supported:
	//   1. Adhoc (preferred): TargetNames / UseDefaultConfig / SpikeDetectionReportName /
	//      StaticTemplateName / AnomalyMagnitude - mirrors the GATE "Add Dashlet" wizard
	//      and is evaluated by the backend against POST /heatmap/adhoc.
	//   2. Legacy: DashletIds - picks an existing persisted GATE heatmap dashlet and
	//      evaluates via POST /heatmap (kept for backward compatibility).
	DashletIds               []int64  `json:"dashletIds,omitempty"`
	MillisAgo                int64    `json:"millisAgo,omitempty"`
	TargetNames              []string `json:"targetNames,omitempty"`
	UseDefaultConfig         *bool    `json:"useDefaultConfig,omitempty"`
	SpikeDetectionReportName string   `json:"spikeDetectionReportName,omitempty"`
	StaticTemplateName       string   `json:"staticTemplateName,omitempty"`
	AnomalyMagnitude         float64  `json:"anomalyMagnitude,omitempty"`
}

type grafanaSeries struct {
	Target     string         `json:"target"`
	Datapoints [][]float64    `json:"datapoints"`
	Tags       map[string]any `json:"tags,omitempty"`
}

// Wire shapes returned by POST /grafana/heatmap.
type heatmapSeries struct {
	Target          string            `json:"target"`
	TargetAlias     string            `json:"targetAlias"`
	IsTargetRunning bool              `json:"isTargetRunning"`
	Datapoints      [][]float64       `json:"datapoints"`
	Tags            map[string]string `json:"tags,omitempty"`
}

type heatmapResponse struct {
	Series             []heatmapSeries `json:"series"`
	TemplateNames      []string        `json:"templateNames"`
	DeletedTargetNames []string        `json:"deletedTargetNames"`
	GeneratedAt        int64           `json:"generatedAt"`
	Cached             bool            `json:"cached"`
}

type backendClient struct {
	baseURL string
	token   string
	client  *http.Client
}

// Dispose here tells plugin SDK that plugin wants to clean up resources when a new instance
// created. As soon as datasource settings change detected by SDK old datasource instance will
// be disposed and a new one will be created using NewSampleDatasource factory function.
func (d *Datasource) Dispose() {
	// Clean up datasource instance resources.
}

// QueryData handles multiple queries and returns multiple responses.
// req contains the queries []DataQuery (where each query contains RefID as a unique identifier).
// The QueryDataResponse contains a map of RefID to the response for each query, and each response
// contains Frames ([]*Frame).
func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	response := backend.NewQueryDataResponse()
	client, err := newBackendClient(req.PluginContext.DataSourceInstanceSettings)
	if err != nil {
		return nil, err
	}

	for _, q := range req.Queries {
		res := d.query(ctx, client, q)
		response.Responses[q.RefID] = res
	}

	return response, nil
}

func (d *Datasource) query(ctx context.Context, client *backendClient, query backend.DataQuery) backend.DataResponse {
	var q queryModel
	if err := json.Unmarshal(query.JSON, &q); err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, "invalid query payload")
	}

	if strings.EqualFold(strings.TrimSpace(q.QueryType), "heatmap") {
		return d.heatmapQuery(ctx, client, query, q)
	}

	if strings.TrimSpace(q.Target) == "" || strings.TrimSpace(q.Capture) == "" || strings.TrimSpace(q.Metric) == "" {
		return backend.DataResponse{Frames: data.Frames{}}
	}

	payload := map[string]any{
		"targets": []map[string]any{
			{
				"target":      q.Target,
				"capture":     q.Capture,
				"metric":      q.Metric,
				"measurement": q.Measurement,
				"spikeOnly":   q.SpikeOnly,
			},
		},
		"rangeFrom": query.TimeRange.From.UnixMilli(),
		"rangeTo":   query.TimeRange.To.UnixMilli(),
	}

	body, err := client.post(ctx, "/query", payload)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusInternal, err.Error())
	}

	var seriesList []grafanaSeries
	if err := json.Unmarshal(body, &seriesList); err != nil {
		return backend.ErrDataResponse(backend.StatusInternal, "invalid backend query response")
	}

	frames := make(data.Frames, 0, len(seriesList))
	for _, series := range seriesList {
		times := make([]time.Time, 0, len(series.Datapoints))
		values := make([]float64, 0, len(series.Datapoints))
		for _, point := range series.Datapoints {
			if len(point) < 2 {
				continue
			}
			values = append(values, point[0])
			times = append(times, time.UnixMilli(int64(point[1])))
		}
		frame := data.NewFrame(series.Target,
			data.NewField("Time", nil, times),
			data.NewField(series.Target, nil, values),
		)
		frames = append(frames, frame)
	}

	return backend.DataResponse{Frames: frames}
}

// heatmapQuery executes a heatmap-mode query and converts each per-target
// series into a Grafana DataFrame. The frame layout (`Time`, `Value`) is
// intentionally generic so it renders correctly under both the `heatmap` and
// `timeseries` panel visualizations.
//
// The exact upstream endpoint is picked from the QueryEditor's mode:
//   - "Create new heatmap" (target names supplied) -> POST /heatmap/adhoc
//   - "Use existing dashlet" (dashlet IDs supplied) -> POST /heatmap
//
// If both are present (corrupted query JSON), the ad-hoc path wins because
// it represents the more recent UI selection.
func (d *Datasource) heatmapQuery(ctx context.Context, client *backendClient, dq backend.DataQuery, q queryModel) backend.DataResponse {
	hasTargets := len(q.TargetNames) > 0
	hasDashlets := len(q.DashletIds) > 0
	if !hasTargets && !hasDashlets {
		return backend.DataResponse{Frames: data.Frames{}}
	}

	// Forward the panel's time picker to the backend so the result aligns
	// with what the user is looking at. millisAgo is kept as a fallback for
	// older callers / explicit overrides via the QueryEditor "Look-back" field.
	var rangeFrom, rangeTo int64
	if dq.TimeRange.From.Unix() > 0 && dq.TimeRange.To.Unix() > 0 {
		rangeFrom = dq.TimeRange.From.UnixMilli()
		rangeTo = dq.TimeRange.To.UnixMilli()
	}
	millisAgo := q.MillisAgo
	if millisAgo <= 0 && rangeFrom > 0 && rangeTo > rangeFrom {
		millisAgo = rangeTo - rangeFrom
	}

	var (
		path    string
		payload map[string]any
	)
	if hasTargets {
		path = "/heatmap/adhoc"
		// Default useDefaultConfig=true matches the GATE wizard default. We
		// dereference the pointer here so callers can leave the field unset.
		useDefaultConfig := true
		if q.UseDefaultConfig != nil {
			useDefaultConfig = *q.UseDefaultConfig
		}
		anomalyMagnitude := q.AnomalyMagnitude
		if anomalyMagnitude == 0 {
			anomalyMagnitude = 1.5
		}
		payload = map[string]any{
			"targetNames":              q.TargetNames,
			"useDefaultConfig":         useDefaultConfig,
			"spikeDetectionReportName": q.SpikeDetectionReportName,
			"staticTemplateName":       q.StaticTemplateName,
			"anomalyMagnitude":         anomalyMagnitude,
		}
	} else {
		path = "/heatmap"
		payload = map[string]any{"dashletIds": q.DashletIds}
	}
	if rangeFrom > 0 && rangeTo > rangeFrom {
		payload["rangeFrom"] = rangeFrom
		payload["rangeTo"] = rangeTo
	}
	if millisAgo > 0 {
		payload["millisAgo"] = millisAgo
	}

	body, err := client.post(ctx, path, payload)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusInternal, err.Error())
	}

	var response heatmapResponse
	if err := json.Unmarshal(body, &response); err != nil {
		return backend.ErrDataResponse(backend.StatusInternal, "invalid heatmap response")
	}

	frames := make(data.Frames, 0, len(response.Series))
	for _, series := range response.Series {
		times := make([]time.Time, 0, len(series.Datapoints))
		values := make([]float64, 0, len(series.Datapoints))
		for _, point := range series.Datapoints {
			if len(point) < 2 {
				continue
			}
			values = append(values, point[0])
			times = append(times, time.UnixMilli(int64(point[1])))
		}
		seriesName := series.TargetAlias
		if strings.TrimSpace(seriesName) == "" {
			seriesName = series.Target
		}
		frame := data.NewFrame(seriesName,
			data.NewField("Time", nil, times),
			data.NewField(seriesName, nil, values),
		)
		// Tag the frame as a time-series so Grafana's Heatmap panel can bucket
		// it into cells when "Calculate from data" is set to Yes. Custom keys
		// surface diagnostic metadata for tooltips/Inspect.
		frame.Meta = &data.FrameMeta{
			Type:                   data.FrameTypeTimeSeriesMulti,
			PreferredVisualization: data.VisType("heatmap"),
			Custom: map[string]any{
				"target":          series.Target,
				"targetAlias":     series.TargetAlias,
				"isTargetRunning": series.IsTargetRunning,
				"cached":          response.Cached,
				"generatedAt":     response.GeneratedAt,
				"tags":            series.Tags,
			},
		}
		frames = append(frames, frame)
	}

	return backend.DataResponse{Frames: frames}
}

// CheckHealth handles health checks sent from Grafana to the plugin.
// The main use case for these health checks is the test button on the
// datasource configuration page which allows users to verify that
// a datasource is working as expected.
func (d *Datasource) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	client, err := newBackendClient(req.PluginContext.DataSourceInstanceSettings)
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: err.Error(),
		}, nil
	}

	body, err := client.post(ctx, "/health", map[string]any{})
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: err.Error(),
		}, nil
	}

	var response struct {
		Status  string `json:"status"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(body, &response)
	if strings.EqualFold(response.Status, "ok") {
		return &backend.CheckHealthResult{Status: backend.HealthStatusOk, Message: response.Message}, nil
	}
	if response.Message == "" {
		response.Message = "health check failed"
	}
	return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: response.Message}, nil
}

func (d *Datasource) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	client, err := newBackendClient(req.PluginContext.DataSourceInstanceSettings)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status:  http.StatusBadRequest,
			Headers: jsonHeaders(),
			Body:    jsonErrorBody(err.Error()),
		})
	}

	// Normalise the path: strip both leading/trailing slashes so we accept
	// "heatmap/dashlets", "/heatmap/dashlets" and "heatmap/dashlets/" alike.
	path := strings.Trim(req.Path, "/")
	switch {
	case path == "health":
		body, postErr := client.post(ctx, "/health", map[string]any{})
		if postErr != nil {
			return sender.Send(&backend.CallResourceResponse{
				Status:  http.StatusBadGateway,
				Headers: jsonHeaders(),
				Body:    jsonErrorBody(postErr.Error()),
			})
		}
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusOK, Headers: jsonHeaders(), Body: body})
	case strings.HasPrefix(path, "variables/"):
		variable := strings.TrimPrefix(path, "variables/")
		var payload map[string]any
		if len(req.Body) > 0 {
			_ = json.Unmarshal(req.Body, &payload)
		}
		if payload == nil {
			payload = map[string]any{}
		}
		body, postErr := client.post(ctx, "/variables/"+url.PathEscape(variable), payload)
		if postErr != nil {
			return sender.Send(&backend.CallResourceResponse{
				Status:  http.StatusBadGateway,
				Headers: jsonHeaders(),
				Body:    jsonErrorBody(postErr.Error()),
			})
		}
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusOK, Headers: jsonHeaders(), Body: body})
	case path == "heatmap/dashlets" ||
		path == "heatmap/reports" ||
		path == "heatmap/templates" ||
		path == "heatmap/targets":
		// All four endpoints are simple GETs under /grafana/heatmap/* and are
		// listed explicitly so unrelated future paths still fall through to
		// the 404 handler. The upstream path is just the request path with a
		// leading slash; the Java backend uses identical names.
		body, getErr := client.get(ctx, "/"+path)
		if getErr != nil {
			return sender.Send(&backend.CallResourceResponse{
				Status:  http.StatusBadGateway,
				Headers: jsonHeaders(),
				Body:    jsonErrorBody(getErr.Error()),
			})
		}
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusOK, Headers: jsonHeaders(), Body: body})
	default:
		// Returning a JSON body keeps getBackendSrv().get()/post() happy: it
		// always parses the response as JSON and would otherwise blow up with
		// "Unexpected token 'r', 'resource not found' is not valid JSON".
		log.DefaultLogger.Warn("HLC datasource: unknown resource path", "path", req.Path, "method", req.Method)
		return sender.Send(&backend.CallResourceResponse{
			Status:  http.StatusNotFound,
			Headers: jsonHeaders(),
			Body:    jsonErrorBody("resource not found: " + req.Path),
		})
	}
}

func jsonHeaders() map[string][]string {
	return map[string][]string{"Content-Type": {"application/json"}}
}

func jsonErrorBody(message string) []byte {
	body, err := json.Marshal(map[string]string{"error": message})
	if err != nil {
		return []byte(`{"error":"internal error"}`)
	}
	return body
}

func newBackendClient(settings *backend.DataSourceInstanceSettings) (*backendClient, error) {
	if settings == nil {
		return nil, fmt.Errorf("missing datasource settings")
	}

	config, err := models.LoadPluginSettings(*settings)
	if err != nil {
		return nil, fmt.Errorf("invalid datasource config")
	}

	baseURL := strings.TrimSpace(config.APIURL)
	if baseURL == "" {
		return nil, fmt.Errorf("apiUrl is required")
	}

	token := strings.TrimSpace(config.Secrets.APIToken)
	return &backendClient{
		baseURL: strings.TrimRight(baseURL, "/") + "/backend/api/grafana",
		token:   token,
		client:  &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func (c *backendClient) post(ctx context.Context, path string, payload any) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to encode request")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to build request")
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req)
}

func (c *backendClient) get(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build request")
	}
	return c.do(req)
}

func (c *backendClient) do(req *http.Request) ([]byte, error) {
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("backend unavailable: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		message := strings.TrimSpace(string(respBody))
		if message == "" {
			message = resp.Status
		}
		return nil, fmt.Errorf("backend error: %s", message)
	}
	return respBody, nil
}

func init() {
	log.DefaultLogger.Debug("HLC datasource backend initialized")
}
