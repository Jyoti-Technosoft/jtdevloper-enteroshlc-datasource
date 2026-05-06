import type { DataQuery, DataSourceJsonData } from '@grafana/data';

export interface HlcQuery extends DataQuery {
  target?: string;
  capture?: string;
  metric?: string;
  measurement?: string;
  spikeOnly?: boolean;
}

export interface HlcDataSourceOptions extends DataSourceJsonData {
  apiUrl?: string;
}

export interface HlcSecureJsonData {
  apiToken?: string;
}

