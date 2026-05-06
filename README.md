# Enteros HLC Datasource

Grafana datasource plugin for querying Enteros HLC metrics through the backend API.

## Features

- Backend-powered datasource implementation using Grafana Go SDK.
- Cascading query selectors for Target, Capture, Metric, and Measurement.
- Secure token support via `secureJsonData.apiToken`.
- Backend resource endpoints for health and variable discovery.

## Configuration

In datasource settings:

- `HLC API URL`: Base URL for the HLC service (for example `https://hlc.example.internal`).
- `API Token`: Bearer token used for backend API requests.

## Local Development

```bash
npm install
npm run dev
```

## Build

Build frontend and backend artifacts:

```bash
npm run build
mage -v
```

## Signing and Publishing

Sign the plugin before submission:

```bash
npm run sign
```

Use Grafana's plugin publishing process documented at:
https://grafana.com/developers/plugin-tools/publish-a-plugin
