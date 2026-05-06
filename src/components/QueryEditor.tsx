import React, { useEffect, useState } from 'react';
import type { QueryEditorProps } from '@grafana/data';
import { InlineField, InlineSwitch, Select } from '@grafana/ui';
import type { HlcDataSource } from '../datasource';
import type { HlcDataSourceOptions, HlcQuery } from '../types';

type Props = QueryEditorProps<HlcDataSource, HlcQuery, HlcDataSourceOptions>;

type Option = { label: string; value: string };

const toOptions = (values: string[]): Option[] => values.map((v) => ({ label: v, value: v }));

export function QueryEditor({ datasource, query, onChange, onRunQuery }: Props) {
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

  const updateQuery = (next: Partial<HlcQuery>) => {
    onChange({ ...query, ...next });
    onRunQuery();
  };

  return (
    <div>
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
    </div>
  );
}

