export type TriggerType = 'manual' | 'schedule' | 'webhook' | 'chat' | 'ingest';

export type NodeKind =
  | 'start'
  | 'sql'
  | 'rest'
  | 'javascript'
  | 'ai'
  | 'condition'
  | 'alert'
  | 'pdf'
  | 's3';

export type NodeFunctionSubtype =
  | 'start'
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'replicate'
  | 'delete_stmt'
  | 'insert_stmt'
  | 'upsert_stmt'
  | 'sql_query'
  | 'rest'
  | 'chatgpt'
  | 'javascript'
  | 'condition'
  | 'alert'
  | 'export_pdf'
  | 'upload_s3';

export interface NodeInputParam {
  id: string;
  name: string;
  type: string;
  defaultValue?: string;
}

export interface WorkflowNodeConfig {
  // SQL
  connectionId?: string;
  connectionName?: string;
  query?: string;
  sqlPreview?: string;
  // REST
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  restAuthId?: string;
  headers?: Record<string, string>;
  body?: string;
  // JavaScript
  code?: string;
  // AI / LLM
  aiProviderId?: string;
  model?: string;
  systemInstruction?: string;
  prompt?: string;
  responseFormat?: 'text' | 'json';
  // Condition
  expression?: string;
  trueBranchLabel?: string;
  falseBranchLabel?: string;
  // Alert
  alertChannelId?: string;
  alertTitle?: string;
  alertCondition?: string;
  severity?: 'info' | 'warning' | 'critical';
  // PDF
  pdfTitle?: string;
  pdfTemplate?: string;
  // S3
  s3CredentialId?: string;
  s3KeyPrefix?: string;
  s3ContentType?: string;
  // Common Settings
  loop?: boolean;
  loopOver?: string;
  lock?: boolean;
  cacheEnabled?: boolean;
  cacheTtl?: number;
}

export interface WorkflowNode {
  id: string;
  kind: NodeKind;
  subtype: NodeFunctionSubtype;
  title: string;
  description?: string;
  x: number;
  y: number;
  inputs: NodeInputParam[];
  config: WorkflowNodeConfig;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  badgeText?: string;
  branch?: number;
}

export interface TriggerConfig {
  cronExpression?: string;
  timezone?: string;
  webhookSlug?: string;
  webhookRequireSecret?: boolean;
  ingestStreamFilter?: string;
  chatWelcomeMessage?: string;
  chatSystemContext?: string;
  manualPayloadJson?: string;
}

export interface NodeExecutionResult {
  nodeId: string;
  nodeTitle: string;
  kind: NodeKind;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
  artifactId?: string;
}

export interface WorkflowRecord {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  isActive: boolean;
  updatedAt: string;
  createdAt: string;
}

export type CredentialCategory =
  | 'sql_datasource'
  | 'rest_auth'
  | 's3_storage'
  | 'ai_provider'
  | 'alert_channel';

export interface CredentialRecord {
  id: string;
  name: string;
  category: CredentialCategory;
  provider: string;
  publicConfig: Record<string, unknown>;
  secretHint: string | null;
  hasSecret: boolean;
  isDefault: boolean;
  lastTestedAt: string | null;
  lastTestStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface IngestedEventRecord {
  id: string;
  stream: string;
  eventType: string;
  source: string;
  payload: Record<string, unknown>;
  receivedAt: string;
}

export interface WorkflowExecutionRecord {
  id: string;
  workflowId: string;
  triggerType: TriggerType;
  status: 'running' | 'completed' | 'failed';
  triggerPayload: Record<string, unknown>;
  nodeResults: Record<string, NodeExecutionResult>;
  error: string | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ArtifactRecord {
  id: string;
  workflowId: string;
  executionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageType: 'pdf_db' | 's3';
  storageKey: string | null;
  s3Url: string | null;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}
