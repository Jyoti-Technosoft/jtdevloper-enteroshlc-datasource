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
	Target      string `json:"target"`
	Capture     string `json:"capture"`
	Metric      string `json:"metric"`
	Measurement string `json:"measurement"`
	SpikeOnly   bool   `json:"spikeOnly"`
}

type grafanaSeries struct {
	Target     string          `json:"target"`
	Datapoints [][]float64     `json:"datapoints"`
	Tags       map[string]any  `json:"tags,omitempty"`
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
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusBadRequest, Body: []byte(err.Error())})
	}

	path := strings.TrimPrefix(req.Path, "/")
	switch {
	case path == "health":
		body, postErr := client.post(ctx, "/health", map[string]any{})
		if postErr != nil {
			return sender.Send(&backend.CallResourceResponse{Status: http.StatusBadGateway, Body: []byte(postErr.Error())})
		}
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusOK, Body: body})
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
			return sender.Send(&backend.CallResourceResponse{Status: http.StatusBadGateway, Body: []byte(postErr.Error())})
		}
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusOK, Body: body})
	default:
		return sender.Send(&backend.CallResourceResponse{Status: http.StatusNotFound, Body: []byte("resource not found")})
	}
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
