import type { DataQuery, DataSourceJsonData } from '@grafana/data';

export type HlcQueryType = 'timeseries' | 'heatmap';

/**
 * Two heatmap sub-modes mirror the GATE flow:
 *  - `adhoc`: configure target / report / template / magnitude inline,
 *     same form as the GATE "Add Dashlet > Heatmap" wizard.
 *  - `dashlet`: reuse an already-persisted GATE heatmap dashlet by id
 *     (kept so users can mirror an existing dashboard 1:1).
 */
export type HeatmapMode = 'adhoc' | 'dashlet';

export interface HlcQuery extends DataQuery {
  queryType?: HlcQueryType;

  // timeseries fields
  target?: string;
  capture?: string;
  metric?: string;
  measurement?: string;
  spikeOnly?: boolean;

  // heatmap fields (queryType === 'heatmap')
  heatmapMode?: HeatmapMode;
  millisAgo?: number;

  // heatmapMode === 'dashlet'
  dashletIds?: number[];

  // heatmapMode === 'adhoc' (mirrors HeatmapDashletConfiguration)
  targetNames?: string[];
  useDefaultConfig?: boolean;
  spikeDetectionReportName?: string;
  staticTemplateName?: string;
  anomalyMagnitude?: number;
}

export interface HlcDataSourceOptions extends DataSourceJsonData {
  apiUrl?: string;
}

export interface HlcSecureJsonData {
  apiToken?: string;
}

/**
 * Lightweight projection of a HeatmapDashletConfiguration returned by the
 * HLC DB backend on GET /grafana/heatmap/dashlets. Used by the query editor
 * to render a dashlet picker.
 */
export interface HeatmapDashletDescriptor {
  dashletId: number;
  userId?: string;
  useDefaultConfig: boolean;
  spikeDetectionReportName?: string;
  anomalyMagnitude: number;
  targetNames: string[];
}

/**
 * GET /grafana/heatmap/reports response item.
 */
export interface HeatmapReportDescriptor {
  name: string;
  hasAlerts: boolean;
}

/**
 * GET /grafana/heatmap/templates response item. `defaultDashboardTemplate`
 * mirrors `ChartsTemplate.isDefaultDashboardTemplate` so the UI can split
 * the dropdown into "System" vs "User" templates exactly like GATE.
 */
export interface HeatmapTemplateDescriptor {
  name: string;
  defaultDashboardTemplate: boolean;
}

/**
 * GET /grafana/heatmap/targets response item.
 */
export interface HeatmapTargetDescriptor {
  name: string;
  aliasName?: string;
  databaseType?: string;
  running: boolean;
}
