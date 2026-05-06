import React from 'react';
import type { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { InlineField, Input, SecretInput } from '@grafana/ui';
import type { HlcDataSourceOptions, HlcSecureJsonData } from '../types';

type Props = DataSourcePluginOptionsEditorProps<HlcDataSourceOptions, HlcSecureJsonData>;

export function ConfigEditor(props: Props) {
  const { options, onOptionsChange } = props;
  const { jsonData, secureJsonData } = options;

  const onApiUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: {
        ...jsonData,
        apiUrl: event.target.value,
      },
    });
  };

  const onTokenChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      secureJsonData: {
        ...secureJsonData,
        apiToken: event.target.value,
      },
    });
  };

  const onResetToken = () => {
    onOptionsChange({
      ...options,
      secureJsonData: {
        ...secureJsonData,
        apiToken: '',
      },
    });
  };

  return (
    <div>
      <InlineField label="HLC API URL" labelWidth={20} tooltip="Example: https://hlc.company.internal">
        <Input
          width={60}
          value={jsonData.apiUrl ?? ''}
          onChange={onApiUrlChange}
          placeholder="https://hlc.example.internal"
        />
      </InlineField>
      <InlineField label="API Token" labelWidth={20} tooltip="Stored in secureJsonData; not exposed in browser requests.">
        <SecretInput
          width={60}
          value={secureJsonData?.apiToken ?? ''}
          onChange={onTokenChange}
          isConfigured={Boolean(options.secureJsonFields?.apiToken)}
          onReset={onResetToken}
          placeholder="Bearer token value"
        />
      </InlineField>
    </div>
  );
}
