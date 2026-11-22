import React, { useState } from 'react';
import {
  Bot,
  CheckCircle2,
  CloudUpload,
  Database,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { CredentialCategory, CredentialRecord } from '../shared/types';

interface CredentialsVaultModalProps {
  open: boolean;
  initialCategory?: CredentialCategory;
  credentials: CredentialRecord[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

const CATEGORY_META: Record<
  CredentialCategory,
  { label: string; icon: React.ComponentType<{ className?: string }>; desc: string }
> = {
  sql_datasource: {
    label: 'SQL Datasources',
    icon: Database,
    desc: 'PostgreSQL / Supabase external or workspace databases',
  },
  rest_auth: {
    label: 'REST External Auth',
    icon: KeyRound,
    desc: 'Bearer, Basic, API Key, or OAuth2 Client Credentials',
  },
  s3_storage: {
    label: 'S3 Storage',
    icon: CloudUpload,
    desc: 'AWS S3, Cloudflare R2, MinIO, or Supabase S3 buckets',
  },
  ai_provider: {
    label: 'AI Providers',
    icon: Bot,
    desc: 'Optional custom OpenAI-compatible LLM endpoints',
  },
  alert_channel: {
    label: 'Alert Channels',
    icon: Webhook,
    desc: 'Slack or custom webhook notification destinations',
  },
};

export function CredentialsVaultModal({
  open,
  initialCategory = 'sql_datasource',
  credentials,
  onClose,
  onRefresh,
}: CredentialsVaultModalProps) {
  const [category, setCategory] = useState<CredentialCategory>(initialCategory);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('postgres');
  const [publicFields, setPublicFields] = useState<Record<string, string>>({});
  const [secretFields, setSecretFields] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  if (!open) return null;

  function resetForm(cat: CredentialCategory) {
    setCategory(cat);
    setCreating(false);
    setName('');
    setPublicFields({});
    setSecretFields({});
    setFeedback(null);
    if (cat === 'sql_datasource') setProvider('postgres');
    else if (cat === 'rest_auth') setProvider('bearer');
    else if (cat === 's3_storage') setProvider('s3');
    else if (cat === 'ai_provider') setProvider('openai_compat');
    else setProvider('webhook');
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setBusyId('create');
    try {
      const publicConfig: Record<string, unknown> = { ...publicFields };
      if (category === 'sql_datasource' && publicFields.port) {
        publicConfig.port = Number(publicFields.port);
      }
      await apiFetch('/api/credentials', {
        method: 'POST',
        body: JSON.stringify({
          name,
          category,
          provider,
          publicConfig,
          secrets: secretFields,
        }),
      });
      await onRefresh();
      setCreating(false);
      setName('');
      setPublicFields({});
      setSecretFields({});
      setFeedback({ type: 'ok', text: 'Credential encrypted and stored in PostgreSQL vault.' });
    } catch (err) {
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleTest(id: string) {
    setBusyId(id);
    setFeedback(null);
    try {
      const res = await apiFetch<{ ok: boolean; status: string; details?: { tables?: string[] } }>(
        `/api/credentials/${id}/test`,
        { method: 'POST' }
      );
      await onRefresh();
      const tablesMsg = res.details?.tables?.length
        ? ` (${res.details.tables.length} tables discovered: ${res.details.tables.slice(0, 5).join(', ')})`
        : '';
      setFeedback({ type: 'ok', text: `Connection test passed: ${res.status}${tablesMsg}` });
    } catch (err) {
      await onRefresh();
      setFeedback({ type: 'err', text: err instanceof Error ? err.message : 'Connection failed' });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    try {
      await apiFetch(`/api/credentials/${id}`, { method: 'DELETE' });
      await onRefresh();
    } finally {
      setBusyId(null);
    }
  }

  const items = credentials.filter((c) => c.category === category);

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[88vh] bg-white border border-[#DCE2EC] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#4B4DED]" />
            <div>
              <h2 className="text-[15px] font-semibold text-[#0F172A]">
                3rd-Party Integrations &amp; Credential Vault
              </h2>
              <p className="text-[12px] text-[#64748B]">
                Secrets are encrypted server-side with AES-256-GCM and never returned to the browser.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex flex-col md:flex-row min-h-0">
          {/* Category Rail */}
          <div className="w-full md:w-56 border-b md:border-b-0 md:border-r border-[#E2E8F0] p-2.5 bg-[#F8FAFC] flex md:flex-col gap-1 overflow-x-auto">
            {(Object.keys(CATEGORY_META) as CredentialCategory[]).map((cat) => {
              const meta = CATEGORY_META[cat];
              const Icon = meta.icon;
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => resetForm(cat)}
                  className={`px-3 py-2 rounded-lg text-left flex items-center gap-2.5 text-[12.5px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'bg-white text-[#0F172A] shadow-xs border border-[#DCE2EC]'
                      : 'text-[#475569] hover:bg-white/70 hover:text-[#0F172A]'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? 'text-[#4B4DED]' : 'text-[#64748B]'}`} />
                  <span>{meta.label}</span>
                </button>
              );
            })}
          </div>

          {/* Content Pane */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-[14px] font-semibold text-[#0F172A]">
                  {CATEGORY_META[category].label}
                </h3>
                <p className="text-[12px] text-[#64748B]">{CATEGORY_META[category].desc}</p>
              </div>
              <button
                type="button"
                onClick={() => setCreating((v) => !v)}
                className="px-3.5 py-2 bg-[#4B4DED] hover:bg-[#4338CA] text-white text-[12.5px] font-medium rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{creating ? 'Cancel' : 'Add Credential'}</span>
              </button>
            </div>

            {feedback && (
              <div
                className={`px-3.5 py-2.5 rounded-lg text-[12.5px] border ${
                  feedback.type === 'ok'
                    ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
                    : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                }`}
              >
                {feedback.text}
              </div>
            )}

            {creating && (
              <form
                onSubmit={handleCreate}
                className="p-4 rounded-xl border border-[#DCE2EC] bg-[#F8FAFC] space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11.5px] font-medium text-[#334155] mb-1">
                      Connection Name
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Analytics Postgres or R2 Bucket"
                      className="w-full px-3 py-1.5 text-[13px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11.5px] font-medium text-[#334155] mb-1">
                      Provider / Auth Scheme
                    </label>
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      className="w-full px-3 py-1.5 text-[13px] bg-white border border-[#DCE2EC] rounded-lg"
                    >
                      {category === 'sql_datasource' && (
                        <option value="postgres">PostgreSQL / Supabase</option>
                      )}
                      {category === 'rest_auth' && (
                        <>
                          <option value="bearer">Bearer Token</option>
                          <option value="apikey">API Key (Header / Query)</option>
                          <option value="basic">Basic Auth</option>
                          <option value="oauth2">OAuth2 Client Credentials</option>
                        </>
                      )}
                      {category === 's3_storage' && (
                        <>
                          <option value="s3">AWS S3</option>
                          <option value="r2">Cloudflare R2</option>
                          <option value="minio">MinIO / S3 Compatible</option>
                        </>
                      )}
                      {category === 'ai_provider' && (
                        <option value="openai_compat">OpenAI-Compatible Endpoint</option>
                      )}
                      {category === 'alert_channel' && (
                        <>
                          <option value="slack">Slack Incoming Webhook</option>
                          <option value="webhook">Custom HTTP Webhook</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>

                {category === 'sql_datasource' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Host (e.g. db.example.com)"
                      value={publicFields.host || ''}
                      onChange={(e) => setPublicFields({ ...publicFields, host: e.target.value })}
                      className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                    <input
                      type="text"
                      placeholder="Port (5432)"
                      value={publicFields.port || '5432'}
                      onChange={(e) => setPublicFields({ ...publicFields, port: e.target.value })}
                      className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                    <input
                      type="text"
                      placeholder="Database name"
                      value={publicFields.database || ''}
                      onChange={(e) =>
                        setPublicFields({ ...publicFields, database: e.target.value })
                      }
                      className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                    <input
                      type="text"
                      placeholder="Username"
                      value={publicFields.user || ''}
                      onChange={(e) => setPublicFields({ ...publicFields, user: e.target.value })}
                      className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                    <input
                      type="password"
                      placeholder="Password (encrypted at rest)"
                      value={secretFields.password || ''}
                      onChange={(e) =>
                        setSecretFields({ ...secretFields, password: e.target.value })
                      }
                      className="sm:col-span-2 px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                    <input
                      type="password"
                      placeholder="Or full PostgreSQL Connection String (optional)"
                      value={secretFields.connectionString || ''}
                      onChange={(e) =>
                        setSecretFields({ ...secretFields, connectionString: e.target.value })
                      }
                      className="sm:col-span-2 px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                  </div>
                )}

                {category === 'rest_auth' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {provider === 'bearer' && (
                      <input
                        type="password"
                        required
                        placeholder="Bearer Token (encrypted at rest)"
                        value={secretFields.token || ''}
                        onChange={(e) =>
                          setSecretFields({ ...secretFields, token: e.target.value })
                        }
                        className="sm:col-span-2 px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                      />
                    )}
                    {provider === 'apikey' && (
                      <>
                        <input
                          type="text"
                          placeholder="Header / Query Name (e.g. X-API-Key)"
                          value={publicFields.headerName || 'X-API-Key'}
                          onChange={(e) =>
                            setPublicFields({ ...publicFields, headerName: e.target.value })
                          }
                          className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                        />
                        <select
                          value={publicFields.location || 'header'}
                          onChange={(e) =>
                            setPublicFields({ ...publicFields, location: e.target.value })
                          }
                          className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                        >
                          <option value="header">Send in Header</option>
                          <option value="query">Send in Query String</option>
                        </select>
                        <input
                          type="password"
                          required
                          placeholder="API Key Value"
                          value={secretFields.apiKey || ''}
                          onChange={(e) =>
                            setSecretFields({ ...secretFields, apiKey: e.target.value })
                          }
                          className="sm:col-span-2 px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                        />
                      </>
                    )}
                    {provider === 'basic' && (
                      <>
                        <input
                          type="text"
                          required
                          placeholder="Username"
                          value={publicFields.username || ''}
                          onChange={(e) =>
                            setPublicFields({ ...publicFields, username: e.target.value })
                          }
                          className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                        />
                        <input
                          type="password"
                          required
                          placeholder="Password"
                          value={secretFields.password || ''}
                          onChange={(e) =>
                            setSecretFields({ ...secretFields, password: e.target.value })
                          }
                          className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                        />
                      </>
                    )}
                    {provider === 'oauth2' && (
                      <>
                        <input
                          type="url"
                          required
                          placeholder="Token URL (https://auth.example.com/oauth/token)"
                          value={publicFields.tokenUrl || ''}
                          onChange={(e) =>
                            setPublicFields({ ...publicFields, tokenUrl: e.target.value })
                          }
                          className="sm:col-span-2 px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                        />
                        <input
                          type="text"
                          required
                          placeholder="Client ID"
                          value={publicFields.clientId || ''}
                          onChange={(e) =>
                            setPublicFields({ ...publicFields, clientId: e.target.value })
                          }
                          className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                        />
                        <input
                          type="password"
                          required
                          placeholder="Client Secret"
                          value={secretFields.clientSecret || ''}
                          onChange={(e) =>
                            setSecretFields({ ...secretFields, clientSecret: e.target.value })
                          }
                          className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                        />
                      </>
                    )}
                  </div>
                )}

                {category === 's3_storage' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="text"
                      required
                      placeholder="Bucket Name"
                      value={publicFields.bucket || ''}
                      onChange={(e) => setPublicFields({ ...publicFields, bucket: e.target.value })}
                      className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                    <input
                      type="text"
                      placeholder="Region (e.g. us-east-1 or auto)"
                      value={publicFields.region || 'us-east-1'}
                      onChange={(e) => setPublicFields({ ...publicFields, region: e.target.value })}
                      className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                    <input
                      type="url"
                      placeholder="Custom S3 Endpoint (for R2 / MinIO / Supabase S3)"
                      value={publicFields.endpoint || ''}
                      onChange={(e) =>
                        setPublicFields({ ...publicFields, endpoint: e.target.value })
                      }
                      className="sm:col-span-2 px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Access Key ID"
                      value={publicFields.accessKeyId || ''}
                      onChange={(e) =>
                        setPublicFields({ ...publicFields, accessKeyId: e.target.value })
                      }
                      className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                    <input
                      type="password"
                      required
                      placeholder="Secret Access Key"
                      value={secretFields.secretAccessKey || ''}
                      onChange={(e) =>
                        setSecretFields({ ...secretFields, secretAccessKey: e.target.value })
                      }
                      className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                  </div>
                )}

                {category === 'ai_provider' && (
                  <div className="grid grid-cols-1 gap-3">
                    <input
                      type="url"
                      required
                      placeholder="Chat Completions Endpoint (https://api.openai.com/v1/chat/completions)"
                      value={publicFields.baseUrl || ''}
                      onChange={(e) =>
                        setPublicFields({ ...publicFields, baseUrl: e.target.value })
                      }
                      className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                    <input
                      type="password"
                      required
                      placeholder="Provider API Key"
                      value={secretFields.apiKey || ''}
                      onChange={(e) =>
                        setSecretFields({ ...secretFields, apiKey: e.target.value })
                      }
                      className="px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                    />
                  </div>
                )}

                {category === 'alert_channel' && (
                  <input
                    type="url"
                    required
                    placeholder="Webhook URL (encrypted at rest)"
                    value={secretFields.webhookUrl || ''}
                    onChange={(e) =>
                      setSecretFields({ ...secretFields, webhookUrl: e.target.value })
                    }
                    className="w-full px-3 py-1.5 text-[12.5px] bg-white border border-[#DCE2EC] rounded-lg"
                  />
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={busyId === 'create'}
                    className="px-4 py-2 bg-[#4B4DED] hover:bg-[#4338CA] text-white text-[12.5px] font-medium rounded-lg"
                  >
                    {busyId === 'create' ? 'Encrypting & Saving...' : 'Save Encrypted Credential'}
                  </button>
                </div>
              </form>
            )}

            {/* Saved Credentials List */}
            <div className="divide-y divide-[#F1F5F9] border border-[#E2E8F0] rounded-xl overflow-hidden">
              {items.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-[#64748B]">
                  No {CATEGORY_META[category].label.toLowerCase()} configured yet.
                </div>
              ) : (
                items.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-[#0F172A]">
                          {item.name}
                        </span>
                        <span className="text-[11.5px] text-[#64748B]">
                          · {item.provider}
                          {item.secretHint ? ` · Secret ${item.secretHint}` : ''}
                        </span>
                      </div>
                      <div className="text-[11.5px] text-[#64748B] mt-0.5 truncate font-mono-code">
                        {item.publicConfig.host
                          ? `${item.publicConfig.host}:${item.publicConfig.port || 5432}/${item.publicConfig.database || ''}`
                          : item.publicConfig.bucket
                            ? `bucket: ${item.publicConfig.bucket} (${item.publicConfig.region || 'us-east-1'})`
                            : item.publicConfig.mode === 'workspace'
                              ? 'Workspace PostgreSQL (weather_data, ingested_events)'
                              : item.lastTestStatus
                                ? `Status: ${item.lastTestStatus}`
                                : 'Encrypted credential stored'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.lastTestStatus === 'connected' && (
                        <span className="text-[11.5px] text-[#16A34A] flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Connected
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => handleTest(item.id)}
                        className="px-2.5 py-1.5 text-[12px] font-medium border border-[#DCE2EC] rounded-lg hover:bg-[#F8FAFC] text-[#334155] flex items-center gap-1.5"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${busyId === item.id ? 'animate-spin' : ''}`}
                        />
                        <span>Test</span>
                      </button>
                      {!item.isDefault && (
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => handleDelete(item.id)}
                          className="p-1.5 text-[#94A3B8] hover:text-[#DC2626] rounded-lg hover:bg-[#FEF2F2]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
