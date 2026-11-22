import React, { useState } from 'react';
import { Check, Copy, Key, Plus, Radio, Terminal, Trash2, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { ApiKeyRecord, IngestedEventRecord } from '../shared/types';

interface IngestApiPanelProps {
  open: boolean;
  apiKeys: ApiKeyRecord[];
  ingestedEvents: IngestedEventRecord[];
  socketConnected: boolean;
  onClose: () => void;
  onRefreshKeys: () => Promise<void>;
}

export function IngestApiPanel({
  open,
  apiKeys,
  ingestedEvents,
  socketConnected,
  onClose,
  onRefreshKeys,
}: IngestApiPanelProps) {
  const [keyName, setKeyName] = useState('');
  const [newPlaintextKey, setNewPlaintextKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!keyName.trim()) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ plaintextKey: string }>('/api/keys', {
        method: 'POST',
        body: JSON.stringify({ name: keyName.trim() }),
      });
      setNewPlaintextKey(res.plaintextKey);
      setKeyName('');
      await onRefreshKeys();
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    setBusy(true);
    try {
      await apiFetch(`/api/keys/${id}`, { method: 'DELETE' });
      await onRefreshKeys();
    } finally {
      setBusy(false);
    }
  }

  const sampleCurl = `curl -X POST ${origin}/api/ingest/weather \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${newPlaintextKey || 'YOUR_API_KEY'}" \\
  -d '{"location":"Toronto","date":"${new Date().toISOString().slice(0, 10)}","temperature":6.8,"condition":"Clear","humidity":62}'`;

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[88vh] bg-white border border-[#DCE2EC] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Key className="w-5 h-5 text-[#4B4DED]" />
            <div>
              <h2 className="text-[15px] font-semibold text-[#0F172A]">
                External Ingest API Keys &amp; Real-Time Stream
              </h2>
              <p className="text-[12px] text-[#64748B]">
                Separate API Key authentication for external systems pushing data into WireLogic via Socket.IO &amp; PostgreSQL.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-[#475569] flex items-center gap-1.5">
              <Radio className={`w-3.5 h-3.5 ${socketConnected ? 'text-[#16A34A]' : 'text-[#94A3B8]'}`} />
              <span>{socketConnected ? 'Socket.IO Live' : 'Reconnecting'}</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Create API Key */}
          <form onSubmit={handleCreateKey} className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              required
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="New API Key label (e.g. Toronto Weather Station)"
              className="flex-1 px-3.5 py-2 text-[13px] border border-[#DCE2EC] rounded-lg focus:outline-none focus:border-[#4B4DED]"
            />
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 bg-[#4B4DED] hover:bg-[#4338CA] text-white text-[13px] font-medium rounded-lg flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Generate Ingest Key</span>
            </button>
          </form>

          {newPlaintextKey && (
            <div className="p-4 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] space-y-2">
              <div className="text-[12.5px] font-semibold text-[#065F46]">
                Copy your Ingest API Key now — it will not be shown again:
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-white border border-[#A7F3D0] rounded-lg text-[12px] font-mono-code text-[#0F172A] break-all">
                  {newPlaintextKey}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(newPlaintextKey);
                    setCopiedKey(true);
                    setTimeout(() => setCopiedKey(false), 1800);
                  }}
                  className="px-3 py-2 bg-white border border-[#A7F3D0] rounded-lg text-[12px] font-medium text-[#065F46] flex items-center gap-1.5"
                >
                  {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Integration & Simulator Guide */}
          <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[#0F172A]">
                <Terminal className="w-4 h-4 text-[#4B4DED]" />
                <span>External System Ingest Example &amp; CLI Simulator</span>
              </div>
              <a
                href="/api/docs"
                target="_blank"
                rel="noreferrer"
                className="text-[12px] font-medium text-[#4B4DED] hover:underline"
              >
                Open Swagger Docs
              </a>
            </div>
            <pre className="p-3 rounded-lg bg-white border border-[#E2E8F0] text-[11px] font-mono-code text-[#1E293B] overflow-x-auto">
              {sampleCurl}
            </pre>
            <div className="text-[11.5px] text-[#64748B]">
              Or run the simulator script externally:{' '}
              <code className="px-1.5 py-0.5 bg-white border border-[#E2E8F0] rounded font-mono-code text-[#0F172A]">
                TEKNA_API_KEY={newPlaintextKey || 'tk_live_...'} npm run simulate:ingest
              </code>
            </div>
          </div>

          {/* Existing API Keys */}
          <div>
            <h3 className="text-[13px] font-semibold text-[#0F172A] mb-2">Active &amp; Revoked Keys</h3>
            <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#F1F5F9] overflow-hidden">
              {apiKeys.length === 0 ? (
                <div className="py-6 text-center text-[12.5px] text-[#64748B]">
                  No API keys created yet.
                </div>
              ) : (
                apiKeys.map((k) => (
                  <div key={k.id} className="px-4 py-3 flex items-center justify-between gap-3 bg-white">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium text-[#0F172A]">{k.name}</span>
                        <span className="text-[11.5px] font-mono-code text-[#64748B]">
                          {k.keyPrefix}••••••••
                        </span>
                        {k.revokedAt && (
                          <span className="text-[11px] text-[#DC2626] font-medium">Revoked</span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#64748B] tabular-nums">
                        Created {new Date(k.createdAt).toLocaleString()}
                        {k.lastUsedAt ? ` · Last used ${new Date(k.lastUsedAt).toLocaleString()}` : ' · Never used'}
                      </div>
                    </div>
                    {!k.revokedAt && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(k.id)}
                        className="px-2.5 py-1 text-[12px] text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Revoke</span>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Live Ingested Events Stream (Socket.IO) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-semibold text-[#0F172A]">
                Live Ingested Events ({ingestedEvents.length})
              </h3>
              <span className="text-[11.5px] text-[#64748B]">
                Updated instantly via Socket.IO
              </span>
            </div>
            <div className="border border-[#E2E8F0] rounded-xl divide-y divide-[#F1F5F9] max-h-64 overflow-y-auto">
              {ingestedEvents.length === 0 ? (
                <div className="py-8 text-center text-[12.5px] text-[#64748B]">
                  Waiting for external systems to POST to <code>/api/ingest/events</code> or{' '}
                  <code>/api/ingest/weather</code>.
                </div>
              ) : (
                ingestedEvents.map((ev) => (
                  <div key={ev.id} className="px-4 py-2.5 bg-white space-y-1">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-medium text-[#0F172A]">
                        {ev.stream} / {ev.eventType}{' '}
                        <span className="text-[#64748B] font-normal">from {ev.source}</span>
                      </span>
                      <span className="text-[11px] text-[#64748B] tabular-nums font-mono-code">
                        {new Date(ev.receivedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <pre className="text-[11px] font-mono-code text-[#334155] truncate">
                      {JSON.stringify(ev.payload)}
                    </pre>
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
