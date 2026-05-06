import { DataSourcePlugin } from '@grafana/data';
import { HlcDataSource } from './datasource';
import { ConfigEditor } from './components/ConfigEditor';
import { QueryEditor } from './components/QueryEditor';
import type { HlcDataSourceOptions, HlcQuery } from './types';

export const plugin = new DataSourcePlugin<HlcDataSource, HlcQuery, HlcDataSourceOptions>(HlcDataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);

