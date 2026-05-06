import { type DataSourceInstanceSettings, type MetricFindValue } from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv } from '@grafana/runtime';
import type { HlcDataSourceOptions, HlcQuery } from './types';

type VariablesKey = 'targets' | 'captures' | 'metrics' | 'measurements';

export class HlcDataSource extends DataSourceWithBackend<HlcQuery, HlcDataSourceOptions> {
  constructor(instanceSettings: DataSourceInstanceSettings<HlcDataSourceOptions>) {
    super(instanceSettings);
  }

  async metricFindQuery(queryText: string): Promise<MetricFindValue[]> {
    const query = queryText.trim().toLowerCase();
    const values = await this.fetchVariableValues(query === 'metrics' ? 'metrics' : 'targets', {});
    return values.map((text) => ({ text }));
  }

  async getTargets(): Promise<string[]> {
    return this.fetchVariableValues('targets', {});
  }

  async getCaptures(targetName: string): Promise<string[]> {
    return this.fetchVariableValues('captures', { targetName });
  }

  async getMetrics(targetName: string, captureName: string): Promise<string[]> {
    return this.fetchVariableValues('metrics', { targetName, captureName });
  }

  async getMeasurements(targetName: string, captureName: string, metricName: string): Promise<string[]> {
    return this.fetchVariableValues('measurements', { targetName, captureName, metricName });
  }

  private async fetchVariableValues(variable: VariablesKey, body: Record<string, string>): Promise<string[]> {
    const response = (await getBackendSrv().post(`/api/datasources/uid/${this.uid}/resources/variables/${variable}`, body)) as string[];
    return Array.isArray(response) ? response : [];
  }
}

