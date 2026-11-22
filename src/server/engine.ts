import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GoogleGenAI } from '@google/genai';
import { and, eq } from 'drizzle-orm';
import vm from 'node:vm';
import PDFDocument from 'pdfkit';
import pg from 'pg';
import type { Server as SocketIOServer } from 'socket.io';
import { db, pool as workspacePool } from '../db/index.js';
import { artifacts, credentials, workflowExecutions } from '../db/schema.js';
import type {
  NodeExecutionResult,
  TriggerType,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRecord,
} from '../shared/types.js';
import { assertSafeOutboundUrl } from './auth.js';
import { decryptVaultSecret } from './crypto.js';

const { Pool } = pg;

// Simple server-side cache for nodes with cacheEnabled: true
const nodeCache = new Map<string, { expiresAt: number; value: unknown }>();

function getByPath(obj: unknown, pathExpr: string): unknown {
  const parts = pathExpr.trim().split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function interpolateText(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, expr: string) => {
    const val = getByPath(context, expr);
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  });
}

function parameterizeSqlTemplate(
  sql: string,
  context: Record<string, unknown>
): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const text = sql.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, expr: string) => {
    const val = getByPath(context, expr);
    values.push(val ?? null);
    return `$${values.length}`;
  });
  return { text, values };
}

async function resolveSqlPool(
  userId: string,
  connectionId?: string
): Promise<{ pool: pg.Pool; isWorkspace: boolean; connectionName: string }> {
  if (!connectionId) {
    return { pool: workspacePool, isWorkspace: true, connectionName: 'Northwinds DB' };
  }

  const rows = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, connectionId), eq(credentials.userId, userId)))
    .limit(1);

  if (rows.length === 0) {
    throw new Error('Selected SQL datasource credential was not found.');
  }

  const cred = rows[0];
  if (cred.provider === 'workspace_pg' || cred.publicConfig?.mode === 'workspace') {
    return { pool: workspacePool, isWorkspace: true, connectionName: cred.name };
  }

  const secret = decryptVaultSecret(cred.encryptedSecret);
  const cfg = cred.publicConfig as Record<string, unknown>;

  if (typeof secret.connectionString === 'string' && secret.connectionString.trim()) {
    const extPool = new Pool({
      connectionString: secret.connectionString,
      ssl: cfg.ssl === false ? false : { rejectUnauthorized: false },
      max: 3,
      connectionTimeoutMillis: 8000,
    });
    return { pool: extPool, isWorkspace: false, connectionName: cred.name };
  }

  const extPool = new Pool({
    host: String(cfg.host || ''),
    port: Number(cfg.port || 5432),
    database: String(cfg.database || 'postgres'),
    user: String(cfg.user || ''),
    password: String(secret.password || ''),
    ssl: cfg.ssl === false ? false : { rejectUnauthorized: false },
    max: 3,
    connectionTimeoutMillis: 8000,
  });

  return { pool: extPool, isWorkspace: false, connectionName: cred.name };
}

async function buildRestHeadersAndAuth(
  userId: string,
  restAuthId?: string,
  baseHeaders?: Record<string, string>
): Promise<{ headers: Record<string, string>; queryParams: Record<string, string> }> {
  const headers: Record<string, string> = { ...(baseHeaders || {}) };
  const queryParams: Record<string, string> = {};

  if (!restAuthId) return { headers, queryParams };

  const rows = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, restAuthId), eq(credentials.userId, userId)))
    .limit(1);

  if (rows.length === 0) {
    throw new Error('Selected REST External Auth credential was not found.');
  }

  const cred = rows[0];
  const cfg = cred.publicConfig as Record<string, unknown>;
  const secret = decryptVaultSecret(cred.encryptedSecret);

  if (cred.provider === 'bearer') {
    headers['Authorization'] = `Bearer ${String(secret.token || '')}`;
  } else if (cred.provider === 'basic') {
    const username = String(cfg.username || '');
    const password = String(secret.password || '');
    headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  } else if (cred.provider === 'apikey') {
    const keyName = String(cfg.headerName || 'X-API-Key');
    const apiKey = String(secret.apiKey || '');
    if (cfg.location === 'query') {
      queryParams[keyName] = apiKey;
    } else {
      headers[keyName] = apiKey;
    }
  } else if (cred.provider === 'oauth2') {
    const tokenUrl = String(cfg.tokenUrl || '');
    await assertSafeOutboundUrl(tokenUrl);
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: String(cfg.clientId || ''),
      client_secret: String(secret.clientSecret || ''),
      ...(cfg.scope ? { scope: String(cfg.scope) } : {}),
    });
    const tokenResp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!tokenResp.ok) {
      throw new Error(`OAuth2 token exchange failed with status ${tokenResp.status}`);
    }
    const tokenJson = (await tokenResp.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      throw new Error('OAuth2 token response did not include access_token');
    }
    headers['Authorization'] = `Bearer ${tokenJson.access_token}`;
  }

  return { headers, queryParams };
}

function runSandboxedJs(
  code: string,
  input: unknown,
  nodes: Record<string, unknown>
): unknown {
  const sandbox = {
    input,
    $input: input,
    nodes,
    Math,
    JSON,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    __result: undefined as unknown,
  };

  const context = vm.createContext(sandbox);

  // Detect named function declaration (e.g., function processWeatherData(...) { ... })
  const fnMatch = code.match(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
  const wrapped = fnMatch
    ? `${code}\n__result = ${fnMatch[1]}(input, nodes);`
    : `__result = (function(input, nodes) {\n${code}\n})(input, nodes);`;

  const script = new vm.Script(wrapped);
  script.runInContext(context, { timeout: 2000 });
  return sandbox.__result;
}

function generatePdfBuffer(title: string, payload: unknown): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(20).fillColor('#111827').text(title || 'WireLogic Workflow Report');
    doc.moveDown(0.35);
    doc
      .fontSize(10)
      .fillColor('#64748b')
      .text(`Generated at ${new Date().toISOString()} · WireLogic`);
    doc.moveDown(1);

    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#e2e8f0').stroke();
    doc.moveDown(1);

    if (payload && typeof payload === 'object') {
      const obj = payload as Record<string, unknown>;
      const rows = Array.isArray(obj.rows)
        ? obj.rows
        : Array.isArray(obj.historical)
          ? obj.historical
          : null;

      doc.fontSize(12).fillColor('#1e293b').text('Summary Telemetry', { underline: false });
      doc.moveDown(0.4);

      for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value)) continue;
        if (value !== null && typeof value === 'object') continue;
        doc
          .fontSize(10)
          .fillColor('#475569')
          .text(`${key}: `, { continued: true })
          .fillColor('#0f172a')
          .text(String(value));
      }

      if (rows && rows.length > 0) {
        doc.moveDown(1);
        doc.fontSize(12).fillColor('#1e293b').text(`Records (${rows.length})`);
        doc.moveDown(0.4);
        for (const row of rows.slice(0, 30)) {
          doc
            .fontSize(9)
            .fillColor('#334155')
            .text(JSON.stringify(row));
          doc.moveDown(0.2);
        }
      } else {
        doc.moveDown(0.8);
        doc.fontSize(11).fillColor('#1e293b').text('Full Payload');
        doc.moveDown(0.3);
        doc
          .fontSize(9)
          .fillColor('#334155')
          .text(JSON.stringify(payload, null, 2));
      }
    } else {
      doc.fontSize(10).fillColor('#334155').text(String(payload ?? 'No data'));
    }

    doc.end();
  });
}

async function executeSingleNode(
  node: WorkflowNode,
  workflow: WorkflowRecord,
  executionId: string,
  userId: string,
  triggerPayload: Record<string, unknown>,
  nodeOutputs: Record<string, unknown>,
  upstreamInput: unknown,
  io?: SocketIOServer
): Promise<{ output: unknown; branch?: number; artifactId?: string }> {
  const ctx: Record<string, unknown> = {
    start: triggerPayload,
    input: upstreamInput,
    nodes: nodeOutputs,
  };

  // Cache check
  if (node.config.cacheEnabled && node.kind !== 'start') {
    const cacheKey = `${workflow.id}:${node.id}:${JSON.stringify(upstreamInput ?? {})}`;
    const cached = nodeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { output: cached.value };
    }
  }

  let result: { output: unknown; branch?: number; artifactId?: string };

  switch (node.kind) {
    case 'start': {
      result = {
        output: {
          triggerType: workflow.triggerType,
          timestamp: new Date().toISOString(),
          ...triggerPayload,
        },
      };
      break;
    }

    case 'sql': {
      const rawQuery = (node.config.query || '').trim();
      if (!rawQuery) {
        throw new Error('SQL node query is empty.');
      }
      const { pool, isWorkspace, connectionName } = await resolveSqlPool(
        userId,
        node.config.connectionId
      );
      try {
        // Basic safety check for workspace shared database: allow SELECT on weather_data / ingested_events, or parameterized DML only when not touching auth/users/sessions
        if (isWorkspace) {
          const lowered = rawQuery.toLowerCase();
          const forbidden = /\b(users|sessions|api_keys|credentials|drop\s+table|truncate|alter\s+table|grant|revoke)\b/i;
          if (forbidden.test(lowered)) {
            throw new Error(
              'Workspace SQL queries cannot access auth/vault tables or execute DDL statements.'
            );
          }
        }
        const { text, values } = parameterizeSqlTemplate(rawQuery, ctx);
        const queryResult = await pool.query(text, values);
        result = {
          output: {
            connection: connectionName,
            rowCount: queryResult.rowCount ?? queryResult.rows.length,
            rows: queryResult.rows,
            fields: queryResult.fields.map((f) => f.name),
          },
        };
      } finally {
        if (!isWorkspace) {
          await pool.end().catch(() => {});
        }
      }
      break;
    }

    case 'rest': {
      const rawUrl = interpolateText((node.config.url || '').trim(), ctx);
      if (!rawUrl) {
        throw new Error('REST node URL is required.');
      }
      const parsedUrl = await assertSafeOutboundUrl(rawUrl);
      const { headers, queryParams } = await buildRestHeadersAndAuth(
        userId,
        node.config.restAuthId,
        node.config.headers
      );
      for (const [k, v] of Object.entries(queryParams)) {
        parsedUrl.searchParams.set(k, v);
      }

      const method = node.config.method || 'GET';
      const hasBody = method !== 'GET' && method !== 'DELETE' && Boolean(node.config.body);
      const bodyStr = hasBody ? interpolateText(node.config.body || '', ctx) : undefined;
      if (hasBody && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      const resp = await fetch(parsedUrl.toString(), {
        method,
        headers,
        body: bodyStr,
      });

      const contentType = resp.headers.get('content-type') || '';
      const rawText = await resp.text();
      let data: unknown = rawText;
      if (contentType.includes('application/json')) {
        try {
          data = JSON.parse(rawText);
        } catch {
          data = rawText;
        }
      }

      if (!resp.ok) {
        throw new Error(`REST ${method} failed (${resp.status}): ${rawText.slice(0, 240)}`);
      }

      result = {
        output: {
          status: resp.status,
          url: parsedUrl.toString(),
          data,
        },
      };
      break;
    }

    case 'javascript': {
      const code = (node.config.code || '').trim();
      if (!code) {
        result = { output: upstreamInput ?? null };
        break;
      }
      const computed = runSandboxedJs(code, upstreamInput, nodeOutputs);
      result = { output: computed };
      break;
    }

    case 'ai': {
      const promptTemplate = node.config.prompt || 'Summarize the upstream data:\n{{input}}';
      const prompt = interpolateText(promptTemplate, ctx);
      const systemInstruction = node.config.systemInstruction
        ? interpolateText(node.config.systemInstruction, ctx)
        : undefined;

      if (node.config.aiProviderId) {
        const rows = await db
          .select()
          .from(credentials)
          .where(
            and(eq(credentials.id, node.config.aiProviderId), eq(credentials.userId, userId))
          )
          .limit(1);
        if (rows.length === 0) {
          throw new Error('Selected AI Provider credential was not found.');
        }
        const cred = rows[0];
        const cfg = cred.publicConfig as Record<string, unknown>;
        const secret = decryptVaultSecret(cred.encryptedSecret);
        const endpoint = String(cfg.baseUrl || 'https://api.openai.com/v1/chat/completions');
        await assertSafeOutboundUrl(endpoint);
        const model = node.config.model || String(cfg.defaultModel || 'gpt-4o-mini');
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${String(secret.apiKey || '')}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
              { role: 'user', content: prompt },
            ],
          }),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`AI provider error (${resp.status}): ${errText.slice(0, 200)}`);
        }
        const json = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        result = {
          output: {
            provider: cred.name,
            model,
            text: json.choices?.[0]?.message?.content || '',
          },
        };
        break;
      }

      if (!process.env.GEMINI_API_KEY) {
        throw new Error(
          'GEMINI_API_KEY is not configured in Settings > Secrets for the built-in AI node.'
        );
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const model = node.config.model || 'gemini-4-hydrogen';
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(node.config.responseFormat === 'json'
            ? { responseMimeType: 'application/json' }
            : {}),
        },
      });
      const text = response.text ?? '';
      let parsed: unknown = text;
      if (node.config.responseFormat === 'json') {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      result = {
        output: {
          model,
          text,
          parsed,
        },
      };
      break;
    }

    case 'condition': {
      const expr = (node.config.expression || 'true').trim();
      const evaluated = Boolean(
        runSandboxedJs(`return Boolean(${expr});`, upstreamInput, nodeOutputs)
      );
      result = {
        output: {
          matched: evaluated,
          branch: evaluated ? 1 : 2,
        },
        branch: evaluated ? 1 : 2,
      };
      break;
    }

    case 'alert': {
      const conditionExpr = (node.config.alertCondition || '').trim();
      let triggered = true;
      if (conditionExpr) {
        triggered = Boolean(
          runSandboxedJs(`return Boolean(${conditionExpr});`, upstreamInput, nodeOutputs)
        );
      }

      const alertPayload = {
        workflowId: workflow.id,
        workflowName: workflow.name,
        executionId,
        title: node.config.alertTitle || node.title,
        severity: node.config.severity || 'warning',
        triggered,
        timestamp: new Date().toISOString(),
        upstream: upstreamInput,
      };

      if (triggered && io) {
        io.to(`user:${userId}`).emit('alert:triggered', alertPayload);
      }

      if (triggered && node.config.alertChannelId) {
        const rows = await db
          .select()
          .from(credentials)
          .where(
            and(eq(credentials.id, node.config.alertChannelId), eq(credentials.userId, userId))
          )
          .limit(1);
        if (rows.length > 0) {
          const secret = decryptVaultSecret(rows[0].encryptedSecret);
          const webhookUrl = String(secret.webhookUrl || '');
          if (webhookUrl) {
            await assertSafeOutboundUrl(webhookUrl);
            await fetch(webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(alertPayload),
            });
          }
        }
      }

      result = { output: alertPayload };
      break;
    }

    case 'pdf': {
      const title = interpolateText(node.config.pdfTitle || `${workflow.name} Report`, ctx);
      const pdfBuffer = await generatePdfBuffer(title, upstreamInput ?? nodeOutputs);
      const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report'}-${Date.now()}.pdf`;

      const [artifact] = await db
        .insert(artifacts)
        .values({
          workflowId: workflow.id,
          executionId,
          userId,
          filename,
          mimeType: 'application/pdf',
          sizeBytes: pdfBuffer.length,
          storageType: 'pdf_db',
          storageKey: filename,
          contentBase64: pdfBuffer.toString('base64'),
        })
        .returning();

      result = {
        artifactId: artifact.id,
        output: {
          artifactId: artifact.id,
          filename,
          sizeBytes: pdfBuffer.length,
          downloadUrl: `/api/artifacts/${artifact.id}/download`,
          base64Length: pdfBuffer.length,
        },
      };
      break;
    }

    case 's3': {
      if (!node.config.s3CredentialId) {
        throw new Error('Select an S3-compatible storage credential in node settings.');
      }
      const rows = await db
        .select()
        .from(credentials)
        .where(
          and(eq(credentials.id, node.config.s3CredentialId), eq(credentials.userId, userId))
        )
        .limit(1);

      if (rows.length === 0) {
        throw new Error('S3 storage credential was not found.');
      }

      const cred = rows[0];
      const cfg = cred.publicConfig as Record<string, unknown>;
      const secret = decryptVaultSecret(cred.encryptedSecret);
      const bucket = String(cfg.bucket || '');
      const region = String(cfg.region || 'us-east-1');
      const endpoint = cfg.endpoint ? String(cfg.endpoint) : undefined;
      if (endpoint) {
        await assertSafeOutboundUrl(endpoint);
      }

      const s3 = new S3Client({
        region,
        ...(endpoint ? { endpoint, forcePathStyle: Boolean(cfg.forcePathStyle ?? true) } : {}),
        credentials: {
          accessKeyId: String(cfg.accessKeyId || secret.accessKeyId || ''),
          secretAccessKey: String(secret.secretAccessKey || ''),
        },
      });

      const prefix = String(node.config.s3KeyPrefix || cfg.prefix || 'wirelogic-exports/').replace(
        /^\/+/,
        ''
      );
      let bodyBuffer: Buffer;
      let contentType = node.config.s3ContentType || 'application/json';
      let ext = 'json';

      const upstreamObj = upstreamInput as Record<string, unknown> | undefined;
      if (upstreamObj && typeof upstreamObj.artifactId === 'string') {
        const [art] = await db
          .select()
          .from(artifacts)
          .where(and(eq(artifacts.id, upstreamObj.artifactId), eq(artifacts.userId, userId)))
          .limit(1);
        if (art?.contentBase64) {
          bodyBuffer = Buffer.from(art.contentBase64, 'base64');
          contentType = art.mimeType;
          ext = 'pdf';
        } else {
          bodyBuffer = Buffer.from(JSON.stringify(upstreamInput ?? {}, null, 2), 'utf8');
        }
      } else {
        bodyBuffer = Buffer.from(JSON.stringify(upstreamInput ?? nodeOutputs, null, 2), 'utf8');
      }

      const objectKey = `${prefix}${workflow.id}/${executionId}.${ext}`;
      const putRes = await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: bodyBuffer,
          ContentType: contentType,
        })
      );

      const s3Url = endpoint
        ? `${endpoint.replace(/\/$/, '')}/${bucket}/${objectKey}`
        : `https://${bucket}.s3.${region}.amazonaws.com/${objectKey}`;

      const [s3Art] = await db
        .insert(artifacts)
        .values({
          workflowId: workflow.id,
          executionId,
          userId,
          filename: objectKey.split('/').pop() || `export.${ext}`,
          mimeType: contentType,
          sizeBytes: bodyBuffer.length,
          storageType: 's3',
          storageKey: objectKey,
          s3Url,
        })
        .returning();

      result = {
        artifactId: s3Art.id,
        output: {
          bucket,
          key: objectKey,
          etag: putRes.ETag,
          url: s3Url,
          sizeBytes: bodyBuffer.length,
        },
      };
      break;
    }

    default: {
      result = { output: upstreamInput ?? null };
    }
  }

  if (node.config.cacheEnabled && node.kind !== 'start') {
    const ttlSeconds = Number(node.config.cacheTtl || 60);
    const cacheKey = `${workflow.id}:${node.id}:${JSON.stringify(upstreamInput ?? {})}`;
    nodeCache.set(cacheKey, {
      expiresAt: Date.now() + ttlSeconds * 1000,
      value: result.output,
    });
  }

  return result;
}

export async function runWorkflow(params: {
  workflow: WorkflowRecord;
  userId: string;
  triggerType: TriggerType;
  triggerPayload?: Record<string, unknown>;
  singleNodeId?: string;
  io?: SocketIOServer;
}): Promise<string> {
  const { workflow, userId, triggerType, triggerPayload = {}, singleNodeId, io } = params;
  const startedAt = new Date();

  const [execution] = await db
    .insert(workflowExecutions)
    .values({
      workflowId: workflow.id,
      userId,
      triggerType,
      status: 'running',
      triggerPayload,
      nodeResults: {},
      startedAt,
    })
    .returning();

  const room = `user:${userId}`;
  io?.to(room).emit('execution:started', {
    executionId: execution.id,
    workflowId: workflow.id,
    triggerType,
    startedAt: startedAt.toISOString(),
  });

  const nodeMap = new Map<string, WorkflowNode>(workflow.nodes.map((n) => [n.id, n]));
  const outgoingMap = new Map<string, WorkflowEdge[]>();
  for (const edge of workflow.edges) {
    const list = outgoingMap.get(edge.source) || [];
    list.push(edge);
    outgoingMap.set(edge.source, list);
  }

  const nodeResults: Record<string, NodeExecutionResult> = {};
  const nodeOutputs: Record<string, unknown> = {};

  try {
    const queue: Array<{ nodeId: string; upstreamInput: unknown }> = [];
    if (singleNodeId) {
      if (!nodeMap.has(singleNodeId)) {
        throw new Error(`Node ${singleNodeId} not found in workflow.`);
      }
      queue.push({ nodeId: singleNodeId, upstreamInput: triggerPayload });
    } else {
      const startNode = workflow.nodes.find((n) => n.kind === 'start') || workflow.nodes[0];
      if (!startNode) {
        throw new Error('Workflow has no nodes to execute.');
      }
      queue.push({ nodeId: startNode.id, upstreamInput: triggerPayload });
    }

    const visited = new Set<string>();

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (visited.has(item.nodeId)) continue;
      visited.add(item.nodeId);

      const node = nodeMap.get(item.nodeId);
      if (!node) continue;

      const nodeStart = new Date();
      nodeResults[node.id] = {
        nodeId: node.id,
        nodeTitle: node.title,
        kind: node.kind,
        status: 'running',
        startedAt: nodeStart.toISOString(),
        input: item.upstreamInput,
      };

      io?.to(room).emit('execution:node:running', {
        executionId: execution.id,
        workflowId: workflow.id,
        nodeId: node.id,
      });

      try {
        const res = await executeSingleNode(
          node,
          workflow,
          execution.id,
          userId,
          triggerPayload,
          nodeOutputs,
          item.upstreamInput,
          io
        );

        const nodeEnd = new Date();
        nodeOutputs[node.id] = res.output;
        nodeResults[node.id] = {
          ...nodeResults[node.id],
          status: 'completed',
          finishedAt: nodeEnd.toISOString(),
          durationMs: nodeEnd.getTime() - nodeStart.getTime(),
          output: res.output,
          artifactId: res.artifactId,
        };

        io?.to(room).emit('execution:node:completed', {
          executionId: execution.id,
          workflowId: workflow.id,
          nodeId: node.id,
          result: nodeResults[node.id],
        });

        if (!singleNodeId) {
          const edges = outgoingMap.get(node.id) || [];
          for (const edge of edges) {
            if (node.kind === 'condition' && res.branch !== undefined && edge.branch !== undefined) {
              if (edge.branch !== res.branch) continue;
            }
            queue.push({ nodeId: edge.target, upstreamInput: res.output });
          }
        }
      } catch (nodeErr) {
        const nodeEnd = new Date();
        const errMsg = nodeErr instanceof Error ? nodeErr.message : String(nodeErr);
        nodeResults[node.id] = {
          ...nodeResults[node.id],
          status: 'failed',
          finishedAt: nodeEnd.toISOString(),
          durationMs: nodeEnd.getTime() - nodeStart.getTime(),
          error: errMsg,
        };

        io?.to(room).emit('execution:node:error', {
          executionId: execution.id,
          workflowId: workflow.id,
          nodeId: node.id,
          error: errMsg,
        });

        throw nodeErr;
      }
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    await db
      .update(workflowExecutions)
      .set({
        status: 'completed',
        nodeResults,
        durationMs,
        finishedAt,
      })
      .where(eq(workflowExecutions.id, execution.id));

    io?.to(room).emit('execution:completed', {
      executionId: execution.id,
      workflowId: workflow.id,
      status: 'completed',
      durationMs,
      nodeResults,
    });
  } catch (err) {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const errMsg = err instanceof Error ? err.message : String(err);

    await db
      .update(workflowExecutions)
      .set({
        status: 'failed',
        nodeResults,
        error: errMsg,
        durationMs,
        finishedAt,
      })
      .where(eq(workflowExecutions.id, execution.id));

    io?.to(room).emit('execution:completed', {
      executionId: execution.id,
      workflowId: workflow.id,
      status: 'failed',
      error: errMsg,
      durationMs,
      nodeResults,
    });
  }

  return execution.id;
}
