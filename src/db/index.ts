import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

function buildPoolConfig(): pg.PoolConfig {
  const useSsl = process.env.PGSSL !== 'disable';
  if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGPASSWORD) {
    throw new Error(
      'PostgreSQL connection environment variables (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD) are not configured.'
    );
  }

  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: 12,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

export const pool = new Pool(buildPoolConfig());
export const db = drizzle(pool, { schema });

export async function ensureDatabaseSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        name text NOT NULL,
        password_hash text NOT NULL,
        role text NOT NULL DEFAULT 'admin',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name text NOT NULL,
        key_prefix text NOT NULL,
        key_hash text NOT NULL UNIQUE,
        scopes jsonb NOT NULL DEFAULT '["ingest:write","ingest:read"]'::jsonb,
        last_used_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS credentials (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name text NOT NULL,
        category text NOT NULL,
        provider text NOT NULL,
        public_config jsonb NOT NULL DEFAULT '{}'::jsonb,
        encrypted_secret text,
        secret_hint text,
        is_default boolean NOT NULL DEFAULT false,
        last_tested_at timestamptz,
        last_test_status text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS workflows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name text NOT NULL,
        description text DEFAULT '',
        trigger_type text NOT NULL DEFAULT 'manual',
        trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
        nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
        edges jsonb NOT NULL DEFAULT '[]'::jsonb,
        is_active boolean NOT NULL DEFAULT true,
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS workflow_executions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        trigger_type text NOT NULL,
        status text NOT NULL DEFAULT 'running',
        trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        node_results jsonb NOT NULL DEFAULT '{}'::jsonb,
        error text,
        duration_ms integer,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz
      );

      CREATE TABLE IF NOT EXISTS ingested_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        api_key_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
        stream text NOT NULL DEFAULT 'default',
        event_type text NOT NULL,
        source text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        received_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS weather_data (
        id serial PRIMARY KEY,
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        location text NOT NULL,
        date text NOT NULL,
        temperature real NOT NULL,
        condition text NOT NULL,
        humidity integer,
        wind_speed real,
        source text NOT NULL DEFAULT 'ingest_api',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        execution_id uuid NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename text NOT NULL,
        mime_type text NOT NULL,
        size_bytes integer NOT NULL,
        storage_type text NOT NULL,
        storage_key text,
        s3_url text,
        content_base64 text,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_weather_data_location_date ON weather_data(location, date DESC);
      CREATE INDEX IF NOT EXISTS idx_ingested_events_user_received ON ingested_events(user_id, received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON workflow_executions(workflow_id, started_at DESC);
    `);
  } finally {
    client.release();
  }
}
