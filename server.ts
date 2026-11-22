import 'dotenv/config';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { and, desc, eq } from 'drizzle-orm';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Server as SocketIOServer } from 'socket.io';
import { z } from 'zod';
import { db, ensureDatabaseSchema, pool as workspacePool } from './src/db/index.js';
import {
  apiKeys,
  artifacts,
  credentials,
  ingestedEvents,
  sessions,
  users,
  weatherData,
  workflowExecutions,
  workflows,
} from './src/db/schema.js';
import {
  assertSafeOutboundUrl,
  requireApiKeyAuth,
  requireUserAuth,
  resolveUserFromToken,
  type ApiKeyRequest,
  type AuthenticatedRequest,
} from './src/server/auth.js';
import {
  buildSecretHint,
  decryptVaultSecret,
  encryptVaultSecret,
  generateOpaqueToken,
  hashPassword,
  sha256Hex,
  verifyPassword,
} from './src/server/crypto.js';
import { seedUserWorkspace } from './src/server/defaultWorkflow.js';
import { runWorkflow } from './src/server/engine.js';
import {
  initializeAllSchedules,
  removeWorkflowSchedule,
  setSchedulerIO,
  syncWorkflowSchedule,
} from './src/server/scheduler.js';
import { mountSwaggerDocs } from './src/server/swagger.js';
import type { CredentialCategory, TriggerType, WorkflowRecord } from './src/shared/types.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

function toWorkflowRecord(row: typeof workflows.$inferSelect): WorkflowRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    triggerType: row.triggerType as TriggerType,
    triggerConfig: row.triggerConfig || {},
    nodes: row.nodes || [],
    edges: row.edges || [],
    isActive: row.isActive,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function toCredentialPublic(row: typeof credentials.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    category: row.category as CredentialCategory,
    provider: row.provider,
    publicConfig: row.publicConfig || {},
    secretHint: row.secretHint,
    hasSecret: Boolean(row.encryptedSecret),
    isDefault: row.isDefault,
    lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
    lastTestStatus: row.lastTestStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function createApp() {
  await ensureDatabaseSchema();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '5mb' }));

  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  setSchedulerIO(io);
  await initializeAllSchedules();

  io.use(async (socket, next) => {
    try {
      const token =
        (typeof socket.handshake.auth?.token === 'string' && socket.handshake.auth.token) ||
        '';
      const user = await resolveUserFromToken(token);
      if (!user) {
        return next(new Error('Unauthorized WebSocket connection'));
      }
      socket.data.user = user;
      next();
    } catch {
      next(new Error('WebSocket authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { id: string; email: string } | undefined;
    if (user) {
      void socket.join(`user:${user.id}`);
      socket.emit('socket:ready', {
        connected: true,
        userId: user.id,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Swagger API Docs
  mountSwaggerDocs(app);

  // Healthcheck
  app.get('/api/health', async (_req, res) => {
    try {
      await workspacePool.query('SELECT 1');
      res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({
        status: 'error',
        error: err instanceof Error ? err.message : 'Database connection error',
      });
    }
  });

  // ============================================================================
  // 1. APP USER AUTHENTICATION (User-based Login / Register / Session)
  // ============================================================================
  const registerSchema = z.object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().email().toLowerCase(),
    password: z.string().min(6).max(128),
  });

  app.post('/api/auth/register', async (req, res, next) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration data' });
        return;
      }

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, parsed.data.email))
        .limit(1);

      if (existing.length > 0) {
        res.status(409).json({ error: 'An account with this email already exists.' });
        return;
      }

      const passwordHash = await hashPassword(parsed.data.password);
      const [createdUser] = await db
        .insert(users)
        .values({
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          role: 'admin',
        })
        .returning();

      await seedUserWorkspace(createdUser.id);

      const token = generateOpaqueToken('tks_');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.insert(sessions).values({
        userId: createdUser.id,
        tokenHash: sha256Hex(token),
        expiresAt,
      });

      res.status(201).json({
        token,
        expiresAt: expiresAt.toISOString(),
        user: {
          id: createdUser.id,
          email: createdUser.email,
          name: createdUser.name,
          role: createdUser.role,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  const loginSchema = z.object({
    email: z.string().trim().email().toLowerCase(),
    password: z.string().min(1),
  });

  app.post('/api/auth/login', async (req, res, next) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid email and password are required.' });
        return;
      }

      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, parsed.data.email))
        .limit(1);

      if (rows.length === 0) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const user = rows[0];
      const valid = await verifyPassword(parsed.data.password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const token = generateOpaqueToken('tks_');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.insert(sessions).values({
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt,
      });

      res.json({
        token,
        expiresAt: expiresAt.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/logout', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (req.sessionToken) {
        await db.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(req.sessionToken)));
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/auth/me', requireUserAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  // ============================================================================
  // 2. INGEST API KEYS MANAGEMENT (User Auth)
  // ============================================================================
  app.get('/api/keys', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, req.user!.id))
        .orderBy(desc(apiKeys.createdAt));

      res.json({
        keys: rows.map((k) => ({
          id: k.id,
          name: k.name,
          keyPrefix: k.keyPrefix,
          scopes: k.scopes,
          lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
          revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
          createdAt: k.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/keys', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const schema = z.object({
        name: z.string().trim().min(2).max(80),
        scopes: z.array(z.string()).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'API key name is required.' });
        return;
      }

      const rawKey = generateOpaqueToken('tk_live_');
      const keyPrefix = rawKey.slice(0, 14);
      const [created] = await db
        .insert(apiKeys)
        .values({
          userId: req.user!.id,
          name: parsed.data.name,
          keyPrefix,
          keyHash: sha256Hex(rawKey),
          scopes: parsed.data.scopes || ['ingest:write', 'ingest:read'],
        })
        .returning();

      res.status(201).json({
        key: {
          id: created.id,
          name: created.name,
          keyPrefix: created.keyPrefix,
          scopes: created.scopes,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: created.createdAt.toISOString(),
        },
        plaintextKey: rawKey,
      });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/keys/:id', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const [updated] = await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, String(req.params.id)), eq(apiKeys.userId, req.user!.id)))
        .returning();

      if (!updated) {
        res.status(404).json({ error: 'API key not found.' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // 3. EXTERNAL INGEST API (Strictly API Key Authenticated)
  // ============================================================================
  const ingestEventSchema = z.object({
    stream: z.string().trim().min(1).max(64).default('default'),
    eventType: z.string().trim().min(1).max(80),
    source: z.string().trim().min(1).max(120),
    payload: z.record(z.string(), z.unknown()),
  });

  async function processIngestedEvent(
    userId: string,
    apiKeyId: string,
    item: z.infer<typeof ingestEventSchema>
  ) {
    const [inserted] = await db
      .insert(ingestedEvents)
      .values({
        userId,
        apiKeyId,
        stream: item.stream,
        eventType: item.eventType,
        source: item.source,
        payload: item.payload,
      })
      .returning();

    // If payload represents weather telemetry, also store into weather_data for SQL querying
    if (
      item.stream === 'weather' &&
      typeof item.payload.location === 'string' &&
      typeof item.payload.temperature === 'number'
    ) {
      await db.insert(weatherData).values({
        userId,
        location: item.payload.location,
        date:
          typeof item.payload.date === 'string'
            ? item.payload.date
            : new Date().toISOString().slice(0, 10),
        temperature: item.payload.temperature,
        condition:
          typeof item.payload.condition === 'string' ? item.payload.condition : 'Clear',
        humidity: typeof item.payload.humidity === 'number' ? Math.round(item.payload.humidity) : null,
        windSpeed: typeof item.payload.windSpeed === 'number' ? item.payload.windSpeed : null,
        source: item.source,
      });
    }

    const publicEvent = {
      id: inserted.id,
      stream: inserted.stream,
      eventType: inserted.eventType,
      source: inserted.source,
      payload: inserted.payload,
      receivedAt: inserted.receivedAt.toISOString(),
    };

    io.to(`user:${userId}`).emit('ingest:received', publicEvent);

    // Trigger any active workflows listening to 'ingest' trigger
    const activeIngestWorkflows = await db
      .select()
      .from(workflows)
      .where(
        and(
          eq(workflows.userId, userId),
          eq(workflows.triggerType, 'ingest'),
          eq(workflows.isActive, true)
        )
      );

    for (const wfRow of activeIngestWorkflows) {
      const wf = toWorkflowRecord(wfRow);
      const streamFilter = (wf.triggerConfig?.ingestStreamFilter || '').trim();
      if (!streamFilter || streamFilter === item.stream || streamFilter === '*') {
        void runWorkflow({
          workflow: wf,
          userId,
          triggerType: 'ingest',
          triggerPayload: publicEvent,
          io,
        });
      }
    }

    return publicEvent;
  }

  app.post('/api/ingest/events', requireApiKeyAuth, async (req: ApiKeyRequest, res, next) => {
    try {
      const parsed = ingestEventSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid ingest payload' });
        return;
      }

      const event = await processIngestedEvent(
        req.apiKey!.userId,
        req.apiKey!.id,
        parsed.data
      );
      res.status(201).json({ status: 'ingested', event });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ingest/batch', requireApiKeyAuth, async (req: ApiKeyRequest, res, next) => {
    try {
      const batchSchema = z.object({
        events: z.array(ingestEventSchema).min(1).max(100),
      });
      const parsed = batchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'events array (1-100 items) is required.' });
        return;
      }

      const results = [];
      for (const item of parsed.data.events) {
        results.push(await processIngestedEvent(req.apiKey!.userId, req.apiKey!.id, item));
      }
      res.status(201).json({ status: 'ingested', count: results.length, events: results });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/ingest/weather', requireApiKeyAuth, async (req: ApiKeyRequest, res, next) => {
    try {
      const weatherSchema = z.object({
        location: z.string().trim().min(1).max(80),
        date: z.string().trim().min(4).max(32),
        temperature: z.number(),
        condition: z.string().trim().min(1).max(80),
        humidity: z.number().int().min(0).max(100).optional(),
        windSpeed: z.number().min(0).optional(),
        source: z.string().trim().default('external_weather_api'),
      });
      const parsed = weatherSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid weather record' });
        return;
      }

      const event = await processIngestedEvent(req.apiKey!.userId, req.apiKey!.id, {
        stream: 'weather',
        eventType: 'weather.observation',
        source: parsed.data.source,
        payload: parsed.data,
      });
      res.status(201).json({ status: 'ingested', event });
    } catch (err) {
      next(err);
    }
  });

  // User-authenticated view of live ingested events & weather_data
  app.get('/api/ingest/feed', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = await db
        .select()
        .from(ingestedEvents)
        .where(eq(ingestedEvents.userId, req.user!.id))
        .orderBy(desc(ingestedEvents.receivedAt))
        .limit(100);

      res.json({
        events: rows.map((r) => ({
          id: r.id,
          stream: r.stream,
          eventType: r.eventType,
          source: r.source,
          payload: r.payload,
          receivedAt: r.receivedAt.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/weather', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = await db
        .select()
        .from(weatherData)
        .where(eq(weatherData.userId, req.user!.id))
        .orderBy(desc(weatherData.createdAt))
        .limit(50);

      res.json({ rows });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // 4. 3RD-PARTY CREDENTIALS VAULT (SQL Datasources, REST Auth, S3, AI, Alerts)
  // ============================================================================
  app.get('/api/credentials', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = await db
        .select()
        .from(credentials)
        .where(eq(credentials.userId, req.user!.id))
        .orderBy(desc(credentials.isDefault), desc(credentials.updatedAt));

      res.json({ credentials: rows.map(toCredentialPublic) });
    } catch (err) {
      next(err);
    }
  });

  const credentialSchema = z.object({
    name: z.string().trim().min(2).max(80),
    category: z.enum(['sql_datasource', 'rest_auth', 's3_storage', 'ai_provider', 'alert_channel']),
    provider: z.string().trim().min(2).max(40),
    publicConfig: z.record(z.string(), z.unknown()).default({}),
    secrets: z.record(z.string(), z.unknown()).optional(),
  });

  app.post('/api/credentials', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = credentialSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid credential input' });
        return;
      }

      const secrets = parsed.data.secrets || {};
      const hasSecretValues = Object.values(secrets).some(
        (v) => typeof v === 'string' && v.trim().length > 0
      );

      const [created] = await db
        .insert(credentials)
        .values({
          userId: req.user!.id,
          name: parsed.data.name,
          category: parsed.data.category,
          provider: parsed.data.provider,
          publicConfig: parsed.data.publicConfig,
          encryptedSecret: hasSecretValues ? encryptVaultSecret(secrets) : null,
          secretHint: hasSecretValues ? buildSecretHint(secrets) : null,
          isDefault: false,
        })
        .returning();

      res.status(201).json({ credential: toCredentialPublic(created) });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/credentials/:id', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const existingRows = await db
        .select()
        .from(credentials)
        .where(and(eq(credentials.id, String(req.params.id)), eq(credentials.userId, req.user!.id)))
        .limit(1);

      if (existingRows.length === 0) {
        res.status(404).json({ error: 'Credential not found.' });
        return;
      }

      const existing = existingRows[0];
      const parsed = credentialSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid credential update payload.' });
        return;
      }

      let encryptedSecret = existing.encryptedSecret;
      let secretHint = existing.secretHint;

      if (parsed.data.secrets) {
        const hasNewSecret = Object.values(parsed.data.secrets).some(
          (v) => typeof v === 'string' && v.trim().length > 0
        );
        if (hasNewSecret) {
          encryptedSecret = encryptVaultSecret(parsed.data.secrets);
          secretHint = buildSecretHint(parsed.data.secrets);
        }
      }

      const [updated] = await db
        .update(credentials)
        .set({
          name: parsed.data.name ?? existing.name,
          provider: parsed.data.provider ?? existing.provider,
          publicConfig: parsed.data.publicConfig ?? existing.publicConfig,
          encryptedSecret,
          secretHint,
          updatedAt: new Date(),
        })
        .where(eq(credentials.id, existing.id))
        .returning();

      res.json({ credential: toCredentialPublic(updated) });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/credentials/:id', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const [deleted] = await db
        .delete(credentials)
        .where(and(eq(credentials.id, String(req.params.id)), eq(credentials.userId, req.user!.id)))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: 'Credential not found.' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/credentials/:id/test', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = await db
        .select()
        .from(credentials)
        .where(and(eq(credentials.id, String(req.params.id)), eq(credentials.userId, req.user!.id)))
        .limit(1);

      if (rows.length === 0) {
        res.status(404).json({ error: 'Credential not found.' });
        return;
      }

      const cred = rows[0];
      const cfg = cred.publicConfig as Record<string, unknown>;
      const secret = decryptVaultSecret(cred.encryptedSecret);
      let statusMsg = 'connected';
      let details: Record<string, unknown> = {};

      if (cred.category === 'sql_datasource') {
        if (cred.provider === 'workspace_pg' || cfg.mode === 'workspace') {
          const tableRes = await workspacePool.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('weather_data', 'ingested_events') ORDER BY table_name"
          );
          details = { tables: tableRes.rows.map((r) => r.table_name) };
        } else {
          const extPool = new Pool(
            typeof secret.connectionString === 'string' && secret.connectionString
              ? {
                  connectionString: secret.connectionString,
                  ssl: cfg.ssl === false ? false : { rejectUnauthorized: false },
                  connectionTimeoutMillis: 6000,
                }
              : {
                  host: String(cfg.host || ''),
                  port: Number(cfg.port || 5432),
                  database: String(cfg.database || 'postgres'),
                  user: String(cfg.user || ''),
                  password: String(secret.password || ''),
                  ssl: cfg.ssl === false ? false : { rejectUnauthorized: false },
                  connectionTimeoutMillis: 6000,
                }
          );
          try {
            const tableRes = await extPool.query(
              "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT 25"
            );
            details = { tables: tableRes.rows.map((r) => r.table_name) };
          } finally {
            await extPool.end().catch(() => {});
          }
        }
      } else if (cred.category === 's3_storage') {
        const endpoint = cfg.endpoint ? String(cfg.endpoint) : undefined;
        if (endpoint) await assertSafeOutboundUrl(endpoint);
        const s3 = new S3Client({
          region: String(cfg.region || 'us-east-1'),
          ...(endpoint ? { endpoint, forcePathStyle: Boolean(cfg.forcePathStyle ?? true) } : {}),
          credentials: {
            accessKeyId: String(cfg.accessKeyId || secret.accessKeyId || ''),
            secretAccessKey: String(secret.secretAccessKey || ''),
          },
        });
        await s3.send(new HeadBucketCommand({ Bucket: String(cfg.bucket || '') }));
        details = { bucket: cfg.bucket };
      } else if (cred.category === 'rest_auth') {
        if (typeof cfg.testUrl === 'string' && cfg.testUrl.trim()) {
          await assertSafeOutboundUrl(cfg.testUrl);
        }
        statusMsg = 'verified';
      } else {
        statusMsg = 'verified';
      }

      await db
        .update(credentials)
        .set({ lastTestedAt: new Date(), lastTestStatus: statusMsg })
        .where(eq(credentials.id, cred.id));

      res.json({ ok: true, status: statusMsg, details });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection test failed';
      await db
        .update(credentials)
        .set({ lastTestedAt: new Date(), lastTestStatus: `error: ${msg.slice(0, 80)}` })
        .where(eq(credentials.id, String(req.params.id)));
      res.status(400).json({ ok: false, error: msg });
    }
  });

  // ============================================================================
  // 5. WORKFLOWS & EXECUTION ENGINE
  // ============================================================================
  app.get('/api/workflows', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = await db
        .select()
        .from(workflows)
        .where(eq(workflows.userId, req.user!.id))
        .orderBy(desc(workflows.updatedAt));

      res.json({ workflows: rows.map(toWorkflowRecord) });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/workflows', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const name = typeof req.body?.name === 'string' && req.body.name.trim()
        ? req.body.name.trim()
        : 'Untitled Workflow';
      const [created] = await db
        .insert(workflows)
        .values({
          userId: req.user!.id,
          name,
          description: '',
          triggerType: 'manual',
          triggerConfig: {
            webhookSlug: generateOpaqueToken('wh_').slice(0, 18),
            cronExpression: '0 * * * *',
            timezone: 'UTC',
            chatWelcomeMessage: 'Send a message to run this workflow.',
            manualPayloadJson: '{}',
          },
          nodes: [
            {
              id: 'start',
              kind: 'start',
              subtype: 'start',
              title: 'Start',
              x: 80,
              y: 220,
              inputs: [],
              config: {},
            },
          ],
          edges: [],
          isActive: true,
        })
        .returning();

      const record = toWorkflowRecord(created);
      syncWorkflowSchedule(record);
      res.status(201).json({ workflow: record });
    } catch (err) {
      next(err);
    }
  });

  app.put('/api/workflows/:id', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const existingRows = await db
        .select()
        .from(workflows)
        .where(and(eq(workflows.id, String(req.params.id)), eq(workflows.userId, req.user!.id)))
        .limit(1);

      if (existingRows.length === 0) {
        res.status(404).json({ error: 'Workflow not found.' });
        return;
      }

      const existing = existingRows[0];
      const [updated] = await db
        .update(workflows)
        .set({
          name: typeof req.body?.name === 'string' ? req.body.name.trim() || existing.name : existing.name,
          description:
            typeof req.body?.description === 'string' ? req.body.description : existing.description,
          triggerType:
            typeof req.body?.triggerType === 'string' ? req.body.triggerType : existing.triggerType,
          triggerConfig: req.body?.triggerConfig ?? existing.triggerConfig,
          nodes: Array.isArray(req.body?.nodes) ? req.body.nodes : existing.nodes,
          edges: Array.isArray(req.body?.edges) ? req.body.edges : existing.edges,
          isActive:
            typeof req.body?.isActive === 'boolean' ? req.body.isActive : existing.isActive,
          updatedAt: new Date(),
        })
        .where(eq(workflows.id, existing.id))
        .returning();

      const record = toWorkflowRecord(updated);
      syncWorkflowSchedule(record);
      io.to(`user:${req.user!.id}`).emit('workflow:updated', record);
      res.json({ workflow: record });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/workflows/:id', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const [deleted] = await db
        .delete(workflows)
        .where(and(eq(workflows.id, String(req.params.id)), eq(workflows.userId, req.user!.id)))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: 'Workflow not found.' });
        return;
      }
      removeWorkflowSchedule(deleted.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/workflows/:id/run', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = await db
        .select()
        .from(workflows)
        .where(and(eq(workflows.id, String(req.params.id)), eq(workflows.userId, req.user!.id)))
        .limit(1);

      if (rows.length === 0) {
        res.status(404).json({ error: 'Workflow not found.' });
        return;
      }

      const wf = toWorkflowRecord(rows[0]);
      const triggerPayload =
        req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
      const singleNodeId =
        typeof req.body?.singleNodeId === 'string' ? req.body.singleNodeId : undefined;
      const triggerMode: TriggerType =
        typeof req.body?.triggerType === 'string'
          ? (req.body.triggerType as TriggerType)
          : wf.triggerType;

      const executionId = await runWorkflow({
        workflow: wf,
        userId: req.user!.id,
        triggerType: triggerMode,
        triggerPayload,
        singleNodeId,
        io,
      });

      const [execRow] = await db
        .select()
        .from(workflowExecutions)
        .where(eq(workflowExecutions.id, executionId))
        .limit(1);

      res.json({ execution: execRow });
    } catch (err) {
      next(err);
    }
  });

  app.get(
    '/api/workflows/:id/executions',
    requireUserAuth,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const rows = await db
          .select()
          .from(workflowExecutions)
          .where(
            and(
              eq(workflowExecutions.workflowId, String(req.params.id)),
              eq(workflowExecutions.userId, req.user!.id)
            )
          )
          .orderBy(desc(workflowExecutions.startedAt))
          .limit(30);

        res.json({ executions: rows });
      } catch (err) {
        next(err);
      }
    }
  );

  // ============================================================================
  // 6. ON EVENT HIT API / WEBHOOK TRIGGER
  // ============================================================================
  app.all('/api/triggers/:slug', async (req, res, next) => {
    try {
      const slug = String(req.params.slug);
      const allWebhookWorkflows = await db
        .select()
        .from(workflows)
        .where(and(eq(workflows.triggerType, 'webhook'), eq(workflows.isActive, true)));

      const matched = allWebhookWorkflows.find(
        (w) => w.triggerConfig?.webhookSlug === slug
      );

      if (!matched) {
        res.status(404).json({ error: 'Active webhook trigger not found for this slug.' });
        return;
      }

      const wf = toWorkflowRecord(matched);
      const payload = {
        method: req.method,
        query: req.query,
        body: req.body && typeof req.body === 'object' ? req.body : {},
        receivedAt: new Date().toISOString(),
      };

      const executionId = await runWorkflow({
        workflow: wf,
        userId: wf.userId,
        triggerType: 'webhook',
        triggerPayload: payload,
        io,
      });

      res.status(202).json({
        status: 'triggered',
        workflowId: wf.id,
        executionId,
      });
    } catch (err) {
      next(err);
    }
  });

  // ============================================================================
  // 7. ARTIFACTS (PDF Downloads & S3 Export History)
  // ============================================================================
  app.get('/api/artifacts', requireUserAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = await db
        .select({
          id: artifacts.id,
          workflowId: artifacts.workflowId,
          executionId: artifacts.executionId,
          filename: artifacts.filename,
          mimeType: artifacts.mimeType,
          sizeBytes: artifacts.sizeBytes,
          storageType: artifacts.storageType,
          storageKey: artifacts.storageKey,
          s3Url: artifacts.s3Url,
          createdAt: artifacts.createdAt,
        })
        .from(artifacts)
        .where(eq(artifacts.userId, req.user!.id))
        .orderBy(desc(artifacts.createdAt))
        .limit(40);

      res.json({ artifacts: rows });
    } catch (err) {
      next(err);
    }
  });

  app.get(
    '/api/artifacts/:id/download',
    requireUserAuth,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const rows = await db
          .select()
          .from(artifacts)
          .where(and(eq(artifacts.id, String(req.params.id)), eq(artifacts.userId, req.user!.id)))
          .limit(1);

        if (rows.length === 0) {
          res.status(404).json({ error: 'Artifact not found.' });
          return;
        }

        const art = rows[0];
        if (!art.contentBase64) {
          res.status(404).json({ error: 'Artifact binary is stored remotely in S3.' });
          return;
        }

        const buf = Buffer.from(art.contentBase64, 'base64');
        res.setHeader('Content-Type', art.mimeType);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${art.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`
        );
        res.send(buf);
      } catch (err) {
        next(err);
      }
    }
  );

  // ============================================================================
  // 8. VITE / STATIC SPA SERVING
  // ============================================================================
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`WireLogic server listening on http://0.0.0.0:${PORT}`);
  });
}

createApp().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
