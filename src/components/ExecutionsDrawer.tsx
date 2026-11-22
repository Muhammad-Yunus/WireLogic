import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Download, MessageSquare, Send, X, XCircle } from 'lucide-react';
import { downloadArtifact } from '../lib/api';
import type { ArtifactRecord, WorkflowExecutionRecord } from '../shared/types';

interface ExecutionsDrawerProps {
  open: boolean;
  mode: 'history' | 'chat';
  executions: WorkflowExecutionRecord[];
  artifacts: ArtifactRecord[];
  chatWelcome?: string;
  onClose: () => void;
  onRunWithChat: (message: string) => Promise<void>;
}

export function ExecutionsDrawer({
  open,
  mode,
  executions,
  artifacts,
  chatWelcome,
  onClose,
  onRunWithChat,
}: ExecutionsDrawerProps) {
  const [tab, setTab] = useState<'history' | 'artifacts' | 'chat'>(
    mode === 'chat' ? 'chat' : 'history'
  );
  const [chatMessage, setChatMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setTab(mode === 'chat' ? 'chat' : 'history');
    }
  }, [open, mode]);

  if (!open) return null;

  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    setSending(true);
    try {
      await onRunWithChat(chatMessage.trim());
      setChatMessage('');
      setTab('history');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#0F172A]/40 backdrop-blur-[2px] flex justify-end">
      <div className="w-full max-w-xl bg-white h-full border-l border-[#DCE2EC] shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setTab('history')}
              className={`text-[13.5px] font-semibold pb-1 border-b-2 transition-colors ${
                tab === 'history'
                  ? 'border-[#4B4DED] text-[#0F172A]'
                  : 'border-transparent text-[#64748B]'
              }`}
            >
              Execution History ({executions.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('artifacts')}
              className={`text-[13.5px] font-semibold pb-1 border-b-2 transition-colors ${
                tab === 'artifacts'
                  ? 'border-[#4B4DED] text-[#0F172A]'
                  : 'border-transparent text-[#64748B]'
              }`}
            >
              PDF &amp; S3 Artifacts ({artifacts.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('chat')}
              className={`text-[13.5px] font-semibold pb-1 border-b-2 transition-colors ${
                tab === 'chat'
                  ? 'border-[#4B4DED] text-[#0F172A]'
                  : 'border-transparent text-[#64748B]'
              }`}
            >
              Chat Trigger
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748B] hover:bg-[#F1F5F9]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {tab === 'history' && (
            <>
              {executions.length === 0 ? (
                <div className="py-12 text-center text-[13px] text-[#64748B]">
                  No workflow runs recorded yet. Click <strong>Run</strong> to execute.
                </div>
              ) : (
                executions.map((ex) => (
                  <div
                    key={ex.id}
                    className="p-3.5 rounded-xl border border-[#E2E8F0] bg-white space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {ex.status === 'completed' ? (
                          <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                        ) : ex.status === 'failed' ? (
                          <XCircle className="w-4 h-4 text-[#DC2626]" />
                        ) : (
                          <Clock className="w-4 h-4 text-[#4B4DED]" />
                        )}
                        <span className="text-[13px] font-semibold text-[#0F172A] capitalize">
                          {ex.status} · {ex.triggerType}
                        </span>
                      </div>
                      <span className="text-[11.5px] text-[#64748B] tabular-nums font-mono-code">
                        {ex.durationMs ?? 0}ms · {new Date(ex.startedAt).toLocaleTimeString()}
                      </span>
                    </div>

                    {ex.error && (
                      <div className="p-2 rounded-lg bg-[#FEF2F2] text-[11.5px] text-[#B91C1C] font-mono-code">
                        {ex.error}
                      </div>
                    )}

                    <div className="space-y-1">
                      {Object.values(ex.nodeResults || {}).map((nr) => (
                        <div
                          key={nr.nodeId}
                          className="px-2.5 py-1.5 rounded-md bg-[#F8FAFC] flex items-center justify-between text-[12px]"
                        >
                          <span className="font-medium text-[#334155]">{nr.nodeTitle}</span>
                          <span className="font-mono-code text-[11px] text-[#64748B] tabular-nums">
                            {nr.status} ({nr.durationMs ?? 0}ms)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {tab === 'artifacts' && (
            <>
              {artifacts.length === 0 ? (
                <div className="py-12 text-center text-[13px] text-[#64748B]">
                  No PDF or S3 artifacts generated yet.
                </div>
              ) : (
                artifacts.map((art) => (
                  <div
                    key={art.id}
                    className="p-3.5 rounded-xl border border-[#E2E8F0] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-[#0F172A] truncate">
                        {art.filename}
                      </div>
                      <div className="text-[11.5px] text-[#64748B] tabular-nums">
                        {art.storageType === 's3' ? 'Uploaded to S3' : 'Generated PDF'} ·{' '}
                        {Math.round(art.sizeBytes / 1024)} KB ·{' '}
                        {new Date(art.createdAt).toLocaleString()}
                      </div>
                    </div>
                    {art.storageType === 'pdf_db' ? (
                      <button
                        type="button"
                        onClick={() => void downloadArtifact(art.id, art.filename)}
                        className="px-3 py-1.5 rounded-lg bg-[#EEF2FF] hover:bg-[#E0E7FF] text-[#3730A3] text-[12px] font-medium flex items-center gap-1.5 shrink-0 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    ) : (
                      <span className="text-[11.5px] font-mono-code text-[#0F766E] truncate max-w-[160px]">
                        {art.storageKey}
                      </span>
                    )}
                  </div>
                ))
              )}
            </>
          )}

          {tab === 'chat' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-start gap-3">
                <MessageSquare className="w-5 h-5 text-[#4B4DED] shrink-0 mt-0.5" />
                <div className="text-[13px] text-[#334155]">
                  {chatWelcome ||
                    'Send a chat message below to invoke this workflow with `Start` output `{ message, sessionId }`.'}
                </div>
              </div>

              <form onSubmit={handleSendChat} className="space-y-3">
                <textarea
                  rows={4}
                  required
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  placeholder="e.g. Generate an executive Toronto weather summary and alert if wind exceeds 40 km/h..."
                  className="w-full p-3 text-[13px] border border-[#DCE2EC] rounded-xl focus:outline-none focus:border-[#4B4DED]"
                />
                <button
                  type="submit"
                  disabled={sending}
                  className="w-full py-2.5 bg-[#4B4DED] hover:bg-[#4338CA] text-white text-[13px] font-medium rounded-lg flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  <span>{sending ? 'Running Workflow...' : 'Start Workflow from Chat'}</span>
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
