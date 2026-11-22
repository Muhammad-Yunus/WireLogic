import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { credentials, workflows } from '../db/schema.js';
import { generateOpaqueToken } from './crypto.js';
import type { WorkflowEdge, WorkflowNode } from '../shared/types.js';

export async function seedUserWorkspace(userId: string): Promise<void> {
  const existingWorkflows = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.userId, userId))
    .limit(1);

  if (existingWorkflows.length > 0) {
    return;
  }

  // Create default Northwinds DB SQL datasource backed by Workspace PostgreSQL
  const [northwinds] = await db
    .insert(credentials)
    .values({
      userId,
      name: 'Northwinds DB',
      category: 'sql_datasource',
      provider: 'workspace_pg',
      publicConfig: {
        mode: 'workspace',
        database: 'postgres',
        schema: 'public',
        tables: ['weather_data', 'ingested_events'],
      },
      isDefault: true,
      lastTestedAt: new Date(),
      lastTestStatus: 'connected',
    })
    .returning();

  const nodes: WorkflowNode[] = [
    {
      id: 'start',
      kind: 'start',
      subtype: 'start',
      title: 'Start',
      description: 'Entry point for Generate Weather Report workflow',
      x: 56,
      y: 222,
      inputs: [],
      config: {},
    },
    {
      id: 'sql_weather',
      kind: 'sql',
      subtype: 'select',
      title: 'Get Weather Data',
      description: '',
      x: 248,
      y: 162,
      inputs: [
        {
          id: 'inp_hist_temp',
          name: 'latestHistoricalTemp',
          type: 'Number[]',
          defaultValue: '[14.2, 15.8, 13.5]',
        },
      ],
      config: {
        connectionId: northwinds.id,
        connectionName: 'Northwinds DB',
        query:
          "SELECT date, temperature, condition, humidity\nFROM weather_data\nWHERE location = 'Toronto'\nORDER BY date DESC LIMIT 7;",
        loop: false,
        lock: false,
        cacheEnabled: true,
        cacheTtl: 300,
      },
    },
    {
      id: 'rest_weather',
      kind: 'rest',
      subtype: 'rest',
      title: 'REST',
      description: 'Makes a REST API request for current weather conditions.',
      x: 540,
      y: 176,
      inputs: [],
      config: {
        method: 'GET',
        url: 'https://api.open-meteo.com/v1/forecast?latitude=43.6532&longitude=-79.3832&current=temperature_2m,relative_humidity_2m,wind_speed_10m',
        headers: {
          Accept: 'application/json',
        },
        loop: false,
        lock: false,
        cacheEnabled: false,
        cacheTtl: 60,
      },
    },
    {
      id: 'js_process',
      kind: 'javascript',
      subtype: 'javascript',
      title: 'JavaScript',
      description: 'Transforms SQL historical readings and live REST weather telemetry.',
      x: 806,
      y: 146,
      inputs: [],
      config: {
        code: `function processWeatherData(input, nodes) {
  const rows = nodes.sql_weather?.rows || [];
  const current = nodes.rest_weather?.data?.current || {};
  return {
    location: "Toronto",
    currentTempC: current.temperature_2m ?? null,
    humidity: current.relative_humidity_2m ?? null,
    windSpeedKmh: current.wind_speed_10m ?? null,
    historicalCount: rows.length,
    historical: rows
  };
}`,
        loop: false,
        lock: false,
        cacheEnabled: false,
        cacheTtl: 60,
      },
    },
    {
      id: 'alert_severe',
      kind: 'alert',
      subtype: 'alert',
      title: 'Alert',
      description: 'Sends an alert if severe weather conditions are detected.',
      x: 806,
      y: 342,
      inputs: [],
      config: {
        alertTitle: 'Severe Weather Conditions Detected',
        alertCondition:
          '(nodes.rest_weather?.data?.current?.wind_speed_10m || 0) > 45 || (nodes.rest_weather?.data?.current?.temperature_2m ?? 20) < -15',
        severity: 'warning',
        loop: false,
        lock: false,
      },
    },
    {
      id: 'export_pdf',
      kind: 'pdf',
      subtype: 'export_pdf',
      title: 'Export to PDF',
      description: 'Generates a formatted PDF report from the processed weather data.',
      x: 1094,
      y: 186,
      inputs: [],
      config: {
        pdfTitle: 'Toronto Weather Intelligence Report',
        pdfTemplate: 'weather_summary',
        loop: false,
        lock: false,
      },
    },
  ];

  const edges: WorkflowEdge[] = [
    { id: 'e_start_sql', source: 'start', target: 'sql_weather', badgeText: '0', branch: 0 },
    { id: 'e_sql_rest', source: 'sql_weather', target: 'rest_weather', badgeText: '2', branch: 2 },
    { id: 'e_rest_js', source: 'rest_weather', target: 'js_process', badgeText: '1', branch: 1 },
    { id: 'e_rest_alert', source: 'rest_weather', target: 'alert_severe', badgeText: '2', branch: 2 },
    { id: 'e_js_pdf', source: 'js_process', target: 'export_pdf', badgeText: '1', branch: 1 },
  ];

  await db.insert(workflows).values({
    userId,
    name: 'Generate Weather Report',
    description:
      'Combines Northwinds PostgreSQL weather telemetry with live REST forecasts, JS transformation, severe alert routing, and PDF reporting.',
    triggerType: 'manual',
    triggerConfig: {
      webhookSlug: generateOpaqueToken('wh_').slice(0, 18),
      cronExpression: '0 */6 * * *',
      timezone: 'UTC',
      ingestStreamFilter: 'weather',
      chatWelcomeMessage: 'Ask me to analyze Toronto weather telemetry or generate a report.',
      manualPayloadJson: JSON.stringify({ location: 'Toronto', requestedBy: 'manual_run' }, null, 2),
    },
    nodes,
    edges,
    isActive: true,
  });
}
