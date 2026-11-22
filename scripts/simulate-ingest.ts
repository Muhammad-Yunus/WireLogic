/**
 * External System Ingest Simulator
 * Sends real HTTP requests to WireLogic's /api/ingest/weather and /api/ingest/events endpoints
 * using an X-API-Key generated in the WireLogic API Keys panel.
 *
 * Usage:
 *   TEKNA_API_KEY=tk_live_... npm run simulate:ingest
 *   TEKNA_URL=http://localhost:3000 TEKNA_API_KEY=tk_live_... npx tsx scripts/simulate-ingest.ts
 */

const BASE_URL = (process.env.TEKNA_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = process.env.TEKNA_API_KEY || '';

if (!API_KEY) {
  console.error(
    'Missing TEKNA_API_KEY environment variable.\nCreate an API Key in WireLogic > API Keys & Ingest, then run:\n  TEKNA_API_KEY=tk_live_your_key npm run simulate:ingest'
  );
  process.exit(1);
}

const sampleReadings = [
  {
    location: 'Toronto',
    date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
    temperature: 7.2,
    condition: 'Mostly Cloudy',
    humidity: 66,
    windSpeed: 19.4,
    source: 'toronto-pearson-station-01',
  },
  {
    location: 'Toronto',
    date: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
    temperature: 5.8,
    condition: 'Light Rain',
    humidity: 78,
    windSpeed: 24.1,
    source: 'toronto-pearson-station-01',
  },
  {
    location: 'Toronto',
    date: new Date().toISOString().slice(0, 10),
    temperature: 8.5,
    condition: 'Partly Sunny',
    humidity: 58,
    windSpeed: 14.0,
    source: 'toronto-downtown-buoy-04',
  },
];

async function runSimulation() {
  console.log(`Sending ${sampleReadings.length} weather telemetry observations to ${BASE_URL}/api/ingest/weather ...`);

  for (const reading of sampleReadings) {
    const resp = await fetch(`${BASE_URL}/api/ingest/weather`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
      },
      body: JSON.stringify(reading),
    });
    const json = await resp.json();
    if (!resp.ok) {
      throw new Error(`Ingest failed (${resp.status}): ${JSON.stringify(json)}`);
    }
    console.log(`Ingested [${reading.date}] ${reading.location} ${reading.temperature}°C -> event ${json.event.id}`);
    await new Promise((r) => setTimeout(r, 450));
  }

  // Also send a generic telemetry event to /api/ingest/events
  const telemetryResp = await fetch(`${BASE_URL}/api/ingest/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY,
    },
    body: JSON.stringify({
      stream: 'weather',
      eventType: 'station.heartbeat',
      source: 'toronto-station-cluster',
      payload: {
        location: 'Toronto',
        activeSensors: 14,
        batteryHealthPct: 97,
        recordedAt: new Date().toISOString(),
      },
    }),
  });
  const telemetryJson = await telemetryResp.json();
  if (!telemetryResp.ok) {
    throw new Error(`Telemetry ingest failed (${telemetryResp.status}): ${JSON.stringify(telemetryJson)}`);
  }
  console.log(`Ingested heartbeat event -> ${telemetryJson.event.id}`);
  console.log('Done! Check the live Socket.IO feed in WireLogic.');
}

runSimulation().catch((err) => {
  console.error(err);
  process.exit(1);
});
