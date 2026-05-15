import { type DataSourceInstanceSettings, type MetricFindValue } from '@grafana/data';
import { DataSourceWithBackend, getBackendSrv } from '@grafana/runtime';
import type {
  HeatmapDashletDescriptor,
  HeatmapReportDescriptor,
  HeatmapTargetDescriptor,
  HeatmapTemplateDescriptor,
  HlcDataSourceOptions,
  HlcQuery,
} from './types';

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

  /**
   * Lists heatmap dashlets exposed by the HLC DB backend so the QueryEditor
   * can render a picker. Proxied through the plugin's Go backend to keep auth
   * (apiToken) consistent with the other resource routes.
   */
  async listHeatmapDashlets(): Promise<HeatmapDashletDescriptor[]> {
    return this.fetchHeatmapResource<HeatmapDashletDescriptor>('heatmap/dashlets');
  }

  /**
   * Lists spike-detection reports for the heatmap wizard's
   * "Spike Detection Report" dropdown. Backed by `ReportService.findAllReports()`
   * on the Java side.
   */
  async listHeatmapReports(): Promise<HeatmapReportDescriptor[]> {
    return this.fetchHeatmapResource<HeatmapReportDescriptor>('heatmap/reports');
  }

  /**
   * Lists charts templates for the heatmap wizard's "Static Template"
   * dropdown. Backed by `ChartsTemplatesService.listTemplates()`.
   */
  async listHeatmapTemplates(): Promise<HeatmapTemplateDescriptor[]> {
    return this.fetchHeatmapResource<HeatmapTemplateDescriptor>('heatmap/templates');
  }

  /**
   * Lists HLC targets (with alias + database type + running flag) for the
   * heatmap wizard's target multiselect. Backed by `TargetService.listTargets()`
   * filtered to `HLCTarget`.
   */
  async listHeatmapTargets(): Promise<HeatmapTargetDescriptor[]> {
    return this.fetchHeatmapResource<HeatmapTargetDescriptor>('heatmap/targets');
  }

  private async fetchHeatmapResource<T>(path: string): Promise<T[]> {
    const response = (await getBackendSrv().get(
      `/api/datasources/uid/${this.uid}/resources/${path}`,
    )) as T[] | null;
    return Array.isArray(response) ? response : [];
  }

  private async fetchVariableValues(variable: VariablesKey, body: Record<string, string>): Promise<string[]> {
    const response = (await getBackendSrv().post(
      `/api/datasources/uid/${this.uid}/resources/variables/${variable}`,
      body,
    )) as string[];
    return Array.isArray(response) ? response : [];
  }
}

