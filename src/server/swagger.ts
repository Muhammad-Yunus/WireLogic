import type { Express } from 'express';
import swaggerUi from 'swagger-ui-express';

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'WireLogic & Ingest API',
    version: '1.0.0',
    description:
      'API documentation for external system data ingestion (X-API-Key), workflow webhook triggers, SQL/REST/S3 credential management, and user authentication.',
  },
  servers: [{ url: '/', description: 'Current WireLogic Server' }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'User session token obtained from /api/auth/login or /api/auth/register',
      },
      IngestApiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API Key generated in WireLogic API Keys panel for external system ingestion',
      },
    },
    schemas: {
      IngestEventInput: {
        type: 'object',
        required: ['eventType', 'source', 'payload'],
        properties: {
          stream: { type: 'string', example: 'weather' },
          eventType: { type: 'string', example: 'sensor.reading' },
          source: { type: 'string', example: 'toronto-station-01' },
          payload: {
            type: 'object',
            example: {
              location: 'Toronto',
              date: '2026-11-21',
              temperature: 6.4,
              condition: 'Partly Cloudy',
              humidity: 68,
              windSpeed: 18.5,
            },
          },
        },
      },
      WeatherIngestInput: {
        type: 'object',
        required: ['location', 'date', 'temperature', 'condition'],
        properties: {
          location: { type: 'string', example: 'Toronto' },
          date: { type: 'string', example: '2026-11-21' },
          temperature: { type: 'number', example: 6.4 },
          condition: { type: 'string', example: 'Clear' },
          humidity: { type: 'integer', example: 62 },
          windSpeed: { type: 'number', example: 14.2 },
          source: { type: 'string', example: 'external-weather-station' },
        },
      },
    },
  },
  paths: {
    '/api/auth/register': {
      post: {
        tags: ['App Auth'],
        summary: 'Register a new user account',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', example: 'Alex Morgan' },
                  email: { type: 'string', example: 'alex@wirelogic.io' },
                  password: { type: 'string', example: 'StrongPass123!' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'User created with Bearer session token' },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['App Auth'],
        summary: 'Sign in with email & password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Authenticated session token' } },
      },
    },
    '/api/ingest/events': {
      post: {
        tags: ['External Ingest API (API Key)'],
        summary: 'Ingest a single telemetry/event payload from an external system',
        security: [{ IngestApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/IngestEventInput' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Event persisted to PostgreSQL and broadcast in real time via Socket.IO',
          },
          '401': { description: 'Missing X-API-Key' },
          '403': { description: 'Invalid or revoked API key' },
        },
      },
    },
    '/api/ingest/batch': {
      post: {
        tags: ['External Ingest API (API Key)'],
        summary: 'Batch ingest up to 100 events in a single HTTP call',
        security: [{ IngestApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['events'],
                properties: {
                  events: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/IngestEventInput' },
                  },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Batch ingested and broadcast' } },
      },
    },
    '/api/ingest/weather': {
      post: {
        tags: ['External Ingest API (API Key)'],
        summary: 'Ingest structured weather telemetry directly into weather_data table',
        security: [{ IngestApiKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/WeatherIngestInput' },
            },
          },
        },
        responses: { '201': { description: 'Weather record inserted & streamed via Socket.IO' } },
      },
    },
    '/api/workflows': {
      get: {
        tags: ['Workflows'],
        summary: 'List all user workflows',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Array of workflows' } },
      },
      post: {
        tags: ['Workflows'],
        summary: 'Create a new workflow',
        security: [{ BearerAuth: [] }],
        responses: { '201': { description: 'Created workflow' } },
      },
    },
    '/api/workflows/{id}/run': {
      post: {
        tags: ['Workflows'],
        summary: 'Trigger manual or chat execution of a workflow',
        security: [{ BearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '202': { description: 'Execution started; live updates via Socket.IO' } },
      },
    },
    '/api/triggers/{slug}': {
      post: {
        tags: ['Webhook Event Triggers'],
        summary: 'Trigger an active webhook workflow by its unique trigger slug',
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', example: { location: 'Toronto', alertTest: true } },
            },
          },
        },
        responses: { '202': { description: 'Webhook workflow execution queued' } },
      },
    },
    '/api/credentials': {
      get: {
        tags: ['3rd-Party Credentials Vault'],
        summary: 'List encrypted SQL, REST Auth, S3, AI, and Alert credentials (secrets redacted)',
        security: [{ BearerAuth: [] }],
        responses: { '200': { description: 'Credential list with masked secret hints' } },
      },
    },
  },
};

export function mountSwaggerDocs(app: Express): void {
  app.get('/api/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: 'WireLogic — API Documentation',
      customCss: '.swagger-ui .topbar { display: none }',
    })
  );
}
