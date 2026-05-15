import React, { useEffect, useMemo, useState } from 'react';
import type { QueryEditorProps } from '@grafana/data';
import { InlineField, InlineSwitch, Input, MultiSelect, Select } from '@grafana/ui';
import type { HlcDataSource } from '../datasource';
import type {
  HeatmapDashletDescriptor,
  HeatmapMode,
  HeatmapReportDescriptor,
  HeatmapTargetDescriptor,
  HeatmapTemplateDescriptor,
  HlcDataSourceOptions,
  HlcQuery,
  HlcQueryType,
} from '../types';

type Props = QueryEditorProps<HlcDataSource, HlcQuery, HlcDataSourceOptions>;

type Option<T = string> = { label: string; value: T };

const toOptions = (values: string[]): Option[] => values.map((v) => ({ label: v, value: v }));

const QUERY_TYPE_OPTIONS: Array<Option<HlcQueryType>> = [
  { label: 'Time series', value: 'timeseries' },
  { label: 'Heatmap', value: 'heatmap' },
];

const HEATMAP_MODE_OPTIONS: Array<Option<HeatmapMode>> = [
  { label: 'Create new heatmap', value: 'adhoc' },
  { label: 'Use existing dashlet', value: 'dashlet' },
];

const DEFAULT_ANOMALY_MAGNITUDE = 1.5;

export function QueryEditor({ datasource, query, onChange, onRunQuery }: Props) {
  const queryType: HlcQueryType = query.queryType ?? 'timeseries';

  const updateQuery = (next: Partial<HlcQuery>) => {
    onChange({ ...query, ...next });
    onRunQuery();
  };

  return (
    <div>
      <InlineField label="Query type" labelWidth={14}>
        <Select<HlcQueryType>
          options={QUERY_TYPE_OPTIONS}
          value={QUERY_TYPE_OPTIONS.find((o) => o.value === queryType) ?? QUERY_TYPE_OPTIONS[0]}
          onChange={(value) => updateQuery({ queryType: value?.value ?? 'timeseries' })}
          width={28}
        />
      </InlineField>

      {queryType === 'heatmap' ? (
        <HeatmapQueryFields datasource={datasource} query={query} updateQuery={updateQuery} />
      ) : (
        <TimeseriesQueryFields datasource={datasource} query={query} updateQuery={updateQuery} />
      )}
    </div>
  );
}

interface SubProps {
  datasource: HlcDataSource;
  query: HlcQuery;
  updateQuery: (next: Partial<HlcQuery>) => void;
}

function TimeseriesQueryFields({ datasource, query, updateQuery }: SubProps) {
  const [targets, setTargets] = useState<Option[]>([]);
  const [captures, setCaptures] = useState<Option[]>([]);
  const [metrics, setMetrics] = useState<Option[]>([]);
  const [measurements, setMeasurements] = useState<Option[]>([]);

  const target = query.target ?? '';
  const capture = query.capture ?? '';
  const metric = query.metric ?? '';
  const measurement = query.measurement ?? '';

  useEffect(() => {
    datasource.getTargets().then((items) => setTargets(toOptions(items)));
  }, [datasource]);

  useEffect(() => {
    if (!target) {
      setCaptures([]);
      return;
    }
    datasource.getCaptures(target).then((items) => setCaptures(toOptions(items)));
  }, [datasource, target]);

  useEffect(() => {
    if (!target || !capture) {
      setMetrics([]);
      return;
    }
    datasource.getMetrics(target, capture).then((items) => setMetrics(toOptions(items)));
  }, [datasource, target, capture]);

  useEffect(() => {
    if (!target || !capture) {
      setMeasurements([]);
      return;
    }
    datasource.getMeasurements(target, capture, metric).then((items) => setMeasurements(toOptions(items)));
  }, [datasource, target, capture, metric]);

  return (
    <>
      <InlineField label="Target" labelWidth={14}>
        <Select
          options={targets}
          value={target ? { label: target, value: target } : null}
          onChange={(value) => updateQuery({ target: value?.value ?? '', capture: '', metric: '', measurement: '' })}
          width={28}
          placeholder="Select target"
        />
      </InlineField>

      <InlineField label="Capture" labelWidth={14}>
        <Select
          options={captures}
          value={capture ? { label: capture, value: capture } : null}
          onChange={(value) => updateQuery({ capture: value?.value ?? '', metric: '', measurement: '' })}
          width={28}
          placeholder="Select capture"
        />
      </InlineField>

      <InlineField label="Metric" labelWidth={14}>
        <Select
          options={metrics}
          value={metric ? { label: metric, value: metric } : null}
          onChange={(value) => updateQuery({ metric: value?.value ?? '', measurement: '' })}
          width={28}
          placeholder="Select metric"
        />
      </InlineField>

      <InlineField label="Measurement" labelWidth={14}>
        <Select
          options={measurements}
          value={measurement ? { label: measurement, value: measurement } : null}
          onChange={(value) => updateQuery({ measurement: value?.value ?? '' })}
          width={28}
          placeholder="Select measurement"
        />
      </InlineField>

      <InlineField label="Spike only" labelWidth={14}>
        <InlineSwitch
          value={Boolean(query.spikeOnly)}
          onChange={(event) => updateQuery({ spikeOnly: event.currentTarget.checked })}
        />
      </InlineField>
    </>
  );
}

/**
 * Heatmap section of the QueryEditor. Mirrors the GATE "Add Dashlet > Heatmap"
 * wizard one-to-one in `adhoc` mode (the default) so the user can create a new
 * heatmap directly from Grafana without first persisting a GATE dashlet, and
 * keeps the legacy "pick an existing dashlet" picker behind a mode switch for
 * backward compatibility.
 */
function HeatmapQueryFields({ datasource, query, updateQuery }: SubProps) {
  const mode: HeatmapMode = query.heatmapMode ?? 'adhoc';

  return (
    <>
      <InlineField label="Heatmap mode" labelWidth={18}>
        <Select<HeatmapMode>
          options={HEATMAP_MODE_OPTIONS}
          value={HEATMAP_MODE_OPTIONS.find((o) => o.value === mode) ?? HEATMAP_MODE_OPTIONS[0]}
          onChange={(value) => updateQuery({ heatmapMode: value?.value ?? 'adhoc' })}
          width={32}
        />
      </InlineField>

      {mode === 'adhoc' ? (
        <HeatmapAdhocFields datasource={datasource} query={query} updateQuery={updateQuery} />
      ) : (
        <HeatmapDashletFields datasource={datasource} query={query} updateQuery={updateQuery} />
      )}

      <HeatmapLookbackField query={query} updateQuery={updateQuery} />
    </>
  );
}

function HeatmapAdhocFields({ datasource, query, updateQuery }: SubProps) {
  const [reports, setReports] = useState<HeatmapReportDescriptor[]>([]);
  const [templates, setTemplates] = useState<HeatmapTemplateDescriptor[]>([]);
  const [targets, setTargets] = useState<HeatmapTargetDescriptor[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      datasource.listHeatmapReports(),
      datasource.listHeatmapTemplates(),
      datasource.listHeatmapTargets(),
    ])
      .then(([reportItems, templateItems, targetItems]) => {
        if (cancelled) {
          return;
        }
        setReports(reportItems);
        setTemplates(templateItems);
        setTargets(targetItems);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasource]);

  // Default useDefaultConfig=true so the form lands in the same state as the
  // GATE wizard. When ON, the report / template dropdowns are disabled and
  // ignored by the backend.
  const useDefaultConfig = query.useDefaultConfig ?? true;

  const reportOptions = useMemo<Option[]>(
    () =>
      reports.map((r) => ({
        value: r.name,
        label: r.hasAlerts ? `${r.name} - has alerts` : r.name,
      })),
    [reports],
  );

  // Split templates into "System" and "User" sections, identical to how the
  // GATE wizard separates `defaultDashboardTemplate === true` from the rest.
  const templateOptions = useMemo<Option[]>(() => {
    const systemTemplates = templates.filter((t) => t.defaultDashboardTemplate);
    const userTemplates = templates.filter((t) => !t.defaultDashboardTemplate);
    return [
      ...userTemplates.map((t) => ({ value: t.name, label: t.name })),
      ...systemTemplates.map((t) => ({ value: t.name, label: `${t.name} (system)` })),
    ];
  }, [templates]);

  const targetOptions = useMemo<Option[]>(
    () =>
      targets.map((t) => {
        const alias = t.aliasName && t.aliasName !== t.name ? ` (${t.aliasName})` : '';
        const dbType = t.databaseType ? ` [${t.databaseType}]` : '';
        const runState = t.running ? '' : ' - stopped';
        return {
          value: t.name,
          label: `${t.name}${alias}${dbType}${runState}`,
        };
      }),
    [targets],
  );

  const selectedTargetNames = query.targetNames ?? [];
  const selectedTargetOptions = targetOptions.filter((o) => selectedTargetNames.includes(o.value));

  const spikeReport = query.spikeDetectionReportName ?? '';
  const staticTemplate = query.staticTemplateName ?? '';
  const anomalyMagnitude = query.anomalyMagnitude ?? DEFAULT_ANOMALY_MAGNITUDE;

  return (
    <>
      <InlineField
        label="Use Default Configuration"
        labelWidth={28}
        tooltip="When ON, the backend applies the global heatmap filter (matches the GATE wizard default). Turn OFF to pick a specific Spike Detection Report and Static Template."
      >
        <InlineSwitch
          value={useDefaultConfig}
          onChange={(event) => {
            const next = event.currentTarget.checked;
            updateQuery({
              useDefaultConfig: next,
              ...(next
                ? { spikeDetectionReportName: undefined, staticTemplateName: undefined }
                : {}),
            });
          }}
        />
      </InlineField>

      <InlineField label="Spike Detection Report" labelWidth={28} disabled={useDefaultConfig}>
        <Select
          options={reportOptions}
          value={spikeReport ? { label: spikeReport, value: spikeReport } : null}
          onChange={(value) => updateQuery({ spikeDetectionReportName: value?.value ?? undefined })}
          width={40}
          placeholder={error ? `Failed to load: ${error}` : 'Select report'}
          isClearable
          disabled={useDefaultConfig}
        />
      </InlineField>

      <InlineField label="Static Template" labelWidth={28} disabled={useDefaultConfig}>
        <Select
          options={templateOptions}
          value={staticTemplate ? { label: staticTemplate, value: staticTemplate } : null}
          onChange={(value) => updateQuery({ staticTemplateName: value?.value ?? undefined })}
          width={40}
          placeholder={error ? `Failed to load: ${error}` : 'Select template'}
          isClearable
          disabled={useDefaultConfig}
        />
      </InlineField>

      <InlineField
        label="Anomaly Magnitude"
        labelWidth={28}
        tooltip="Only alerts with anomalyRank > anomalyMagnitude are returned. GATE default is 1.5."
      >
        <Input
          type="number"
          value={anomalyMagnitude}
          width={20}
          step={0.1}
          onChange={(event) => {
            const raw = event.currentTarget.value;
            const parsed = raw === '' ? DEFAULT_ANOMALY_MAGNITUDE : Number(raw);
            updateQuery({ anomalyMagnitude: Number.isFinite(parsed) ? parsed : DEFAULT_ANOMALY_MAGNITUDE });
          }}
        />
      </InlineField>

      <InlineField label="Select Targets" labelWidth={28} grow>
        <MultiSelect
          options={targetOptions}
          value={selectedTargetOptions}
          onChange={(values) => updateQuery({ targetNames: values.map((v) => v.value as string) })}
          placeholder={error ? `Failed to load: ${error}` : 'Select one or more targets'}
          isClearable
        />
      </InlineField>
    </>
  );
}

function HeatmapDashletFields({ datasource, query, updateQuery }: SubProps) {
  const [dashlets, setDashlets] = useState<HeatmapDashletDescriptor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    datasource
      .listHeatmapDashlets()
      .then((items) => {
        if (!cancelled) {
          setDashlets(items);
          setLoadError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasource]);

  const options = useMemo<Array<Option<number>>>(
    () =>
      dashlets.map((d) => ({
        value: d.dashletId,
        label: `#${d.dashletId} - ${d.targetNames.join(', ') || '(no targets)'}${d.userId ? ` [${d.userId}]` : ''}`,
      })),
    [dashlets],
  );

  const selectedIds = query.dashletIds ?? [];
  const selectedOptions = options.filter((o) => selectedIds.includes(o.value));

  return (
    <InlineField label="Heatmap dashlets" labelWidth={18} grow>
      <MultiSelect<number>
        options={options}
        value={selectedOptions}
        onChange={(values) => updateQuery({ dashletIds: values.map((v) => v.value as number) })}
        placeholder={loadError ? `Failed to load: ${loadError}` : 'Select one or more heatmap dashlets'}
        isClearable
      />
    </InlineField>
  );
}

function HeatmapLookbackField({ query, updateQuery }: Pick<SubProps, 'query' | 'updateQuery'>) {
  const millisAgo = query.millisAgo ?? 0;
  return (
    <InlineField
      label="Look-back (ms)"
      labelWidth={18}
      tooltip="Override the panel time range. Leave blank to derive from the dashboard time picker."
    >
      <Input
        type="number"
        value={millisAgo || ''}
        width={28}
        placeholder="auto"
        onChange={(event) => {
          const raw = event.currentTarget.value;
          const parsed = raw === '' ? undefined : Number(raw);
          updateQuery({ millisAgo: Number.isFinite(parsed as number) ? (parsed as number) : undefined });
        }}
      />
    </InlineField>
  );
}
