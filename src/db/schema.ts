import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  NodeExecutionResult,
  TriggerConfig,
  WorkflowEdge,
  WorkflowNode,
} from '../shared/types.js';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('admin'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: jsonb('scopes').$type<string[]>().notNull().default(['ingest:write', 'ingest:read']),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const credentials = pgTable('credentials', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category').notNull(),
  provider: text('provider').notNull(),
  publicConfig: jsonb('public_config').$type<Record<string, unknown>>().notNull().default({}),
  encryptedSecret: text('encrypted_secret'),
  secretHint: text('secret_hint'),
  isDefault: boolean('is_default').notNull().default(false),
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  lastTestStatus: text('last_test_status'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workflows = pgTable('workflows', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').default(''),
  triggerType: text('trigger_type').notNull().default('manual'),
  triggerConfig: jsonb('trigger_config').$type<TriggerConfig>().notNull().default({}),
  nodes: jsonb('nodes').$type<WorkflowNode[]>().notNull().default([]),
  edges: jsonb('edges').$type<WorkflowEdge[]>().notNull().default([]),
  isActive: boolean('is_active').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workflowExecutions = pgTable('workflow_executions', {
  id: uuid('id').defaultRandom().primaryKey(),
  workflowId: uuid('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  triggerType: text('trigger_type').notNull(),
  status: text('status').notNull().default('running'),
  triggerPayload: jsonb('trigger_payload').$type<Record<string, unknown>>().notNull().default({}),
  nodeResults: jsonb('node_results')
    .$type<Record<string, NodeExecutionResult>>()
    .notNull()
    .default({}),
  error: text('error'),
  durationMs: integer('duration_ms'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const ingestedEvents = pgTable('ingested_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
  stream: text('stream').notNull().default('default'),
  eventType: text('event_type').notNull(),
  source: text('source').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
});

export const weatherData = pgTable('weather_data', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  location: text('location').notNull(),
  date: text('date').notNull(),
  temperature: real('temperature').notNull(),
  condition: text('condition').notNull(),
  humidity: integer('humidity'),
  windSpeed: real('wind_speed'),
  source: text('source').notNull().default('ingest_api'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const artifacts = pgTable('artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  workflowId: uuid('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  executionId: uuid('execution_id')
    .notNull()
    .references(() => workflowExecutions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageType: text('storage_type').notNull(),
  storageKey: text('storage_key'),
  s3Url: text('s3_url'),
  contentBase64: text('content_base64'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
