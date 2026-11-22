import React, { useState } from 'react';
import {
  CalendarClock,
  Check,
  Copy,
  Download,
  ExternalLink,
  MessageSquare,
  Minus,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
  Webhook,
  Zap,
} from 'lucide-react';
import { getAuthToken } from '../lib/api';
import type {
  CredentialRecord,
  NodeExecutionResult,
  TriggerConfig,
  TriggerType,
  WorkflowNode,
} from '../shared/types';
import { NodeBadgeIcon } from './NodeMeta';
import { SyntaxCodeBlock } from './SyntaxCodeBlock';

interface NodeInspectorProps {
  node: WorkflowNode | null;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  isActive: boolean;
  collapsed: boolean;
  credentials: CredentialRecord[];
  runResult?: NodeExecutionResult;
  onToggleCollapse: () => void;
  onUpdateNode: (nodeId: string, updater: (prev: WorkflowNode) => WorkflowNode) => void;
  onUpdateTrigger: (triggerType: TriggerType, triggerConfig: TriggerConfig, isActive?: boolean) => void;
  onRunNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onOpenVault: (category?: CredentialRecord['category']) => void;
  onOpenChatRunner: () => void;
}

export function NodeInspector({
  node,
  triggerType,
  triggerConfig,
  isActive,
  collapsed,
  credentials,
  runResult,
  onToggleCollapse,
  onUpdateNode,
  onUpdateTrigger,
  onRunNode,
  onDeleteNode,
  onOpenVault,
  onOpenChatRunner,
}: NodeInspectorProps) {
  const [activeTab, setActiveTab] = useState<'input' | 'output'>('input');
  const [editingCode, setEditingCode] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  if (!node) return null;

  // COLLAPSED FLOATING PILL (matches Screenshot 2 top-right card)
  if (collapsed) {
    return (
      <div className="absolute top-3.5 right-4 z-30 w-[300px] sm:w-[320px] bg-white border border-[#DCE2EC] rounded-[10px] shadow-[0_4px_16px_rgba(15,23,42,0.06)] px-3.5 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <NodeBadgeIcon kind={node.kind} subtype={node.subtype} />
          <span className="text-[13px] font-semibold text-[#0F172A] truncate">{node.title}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[#475569] shrink-0">
          <button
            type="button"
            title="Run node"
            onClick={() => onRunNode(node.id)}
            className="p-1 rounded hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Delete node"
            onClick={() => {
              if (node.kind !== 'start') onDeleteNode(node.id);
            }}
            className="p-1 rounded hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Expand inspector"
            onClick={onToggleCollapse}
            className="p-1 rounded hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  const sqlConnections = credentials.filter((c) => c.category === 'sql_datasource');
  const restAuths = credentials.filter((c) => c.category === 'rest_auth');
  const s3Stores = credentials.filter((c) => c.category === 's3_storage');
  const aiProviders = credentials.filter((c) => c.category === 'ai_provider');
  const alertChannels = credentials.filter((c) => c.category === 'alert_channel');

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/triggers/${triggerConfig.webhookSlug || 'default'}`
      : `/api/triggers/${triggerConfig.webhookSlug || 'default'}`;

  function handleAddInputRow() {
    if (!node) return;
    onUpdateNode(node.id, (prev) => ({
      ...prev,
      inputs: [
        ...prev.inputs,
        {
          id: `inp_${Date.now().toString(36)}`,
          name: `param${prev.inputs.length + 1}`,
          type: 'String',
          defaultValue: '',
        },
      ],
    }));
  }

  function handleUpdateInputRow(rowId: string, field: 'name' | 'type', val: string) {
    if (!node) return;
    onUpdateNode(node.id, (prev) => ({
      ...prev,
      inputs: prev.inputs.map((r) => (r.id === rowId ? { ...r, [field]: val } : r)),
    }));
  }

  function handleRemoveInputRow(rowId: string) {
    if (!node) return;
    onUpdateNode(node.id, (prev) => ({
      ...prev,
      inputs: prev.inputs.filter((r) => r.id !== rowId),
    }));
  }

  const outputObj = runResult?.output as Record<string, unknown> | undefined;

  return (
    <aside className="absolute top-3.5 right-3.5 bottom-3.5 z-30 w-[356px] max-w-[calc(100vw-1.75rem)] bg-white border border-[#DCE2EC] rounded-[12px] shadow-[0_12px_36px_rgba(15,23,42,0.1)] flex flex-col overflow-hidden">
      {/* Inspector Header (matches Screenshot 1) */}
      <div className="px-4 pt-3.5 pb-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <NodeBadgeIcon kind={node.kind} subtype={node.subtype} />
            <input
              type="text"
              value={node.title}
              onChange={(e) =>
                onUpdateNode(node.id, (prev) => ({ ...prev, title: e.target.value }))
              }
              className="text-[14px] font-semibold text-[#0F172A] bg-transparent border-none focus:outline-none w-full truncate"
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              title="Run this node"
              onClick={() => onRunNode(node.id)}
              className="p-1.5 rounded-md text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              title="Collapse inspector"
              onClick={onToggleCollapse}
              className="p-1.5 rounded-md text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A]"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <input
          type="text"
          value={node.description || ''}
          onChange={(e) =>
            onUpdateNode(node.id, (prev) => ({ ...prev, description: e.target.value }))
          }
          placeholder="Add a description (optional)"
          className="mt-1.5 w-full text-[12px] text-[#64748B] placeholder:text-[#94A3B8] bg-transparent focus:outline-none"
        />
      </div>

      {/* Input / Output Tabs */}
      <div className="px-4 border-b border-[#E2E8F0] flex items-center gap-5">
        <button
          type="button"
          onClick={() => setActiveTab('input')}
          className={`py-2 text-[12.5px] font-medium border-b-2 transition-colors ${
            activeTab === 'input'
              ? 'border-[#0F172A] text-[#0F172A]'
              : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          Input ({node.inputs.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('output')}
          className={`py-2 text-[12.5px] font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'output'
              ? 'border-[#0F172A] text-[#0F172A]'
              : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          <span>Output</span>
          {runResult?.status === 'completed' && (
            <span className="text-[10.5px] text-[#16A34A] font-mono-code tabular-nums">
              {runResult.durationMs ?? 0}ms
            </span>
          )}
          {runResult?.status === 'failed' && (
            <span className="text-[10.5px] text-[#DC2626]">Error</span>
          )}
        </button>
      </div>

      {/* Scrollable Inspector Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-5">
        {activeTab === 'output' ? (
          <div className="space-y-3">
            {!runResult ? (
              <div className="py-10 text-center text-[12.5px] text-[#64748B]">
                No execution output yet. Click <strong>Run</strong> to execute this workflow.
              </div>
            ) : runResult.status === 'failed' ? (
              <div className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[12px] text-[#B91C1C] font-mono-code whitespace-pre-wrap">
                {runResult.error || 'Execution failed'}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-[12px] text-[#64748B]">
                  <span>Status: Completed</span>
                  <span className="tabular-nums font-mono-code">{runResult.durationMs} ms</span>
                </div>

                {outputObj && typeof outputObj.downloadUrl === 'string' && (
                  <a
                    href={`${outputObj.downloadUrl}?token=${encodeURIComponent(getAuthToken() || '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2 px-3 rounded-lg bg-[#EEF2FF] hover:bg-[#E0E7FF] text-[#3730A3] text-[12.5px] font-medium flex items-center justify-center gap-2 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download {String(outputObj.filename || 'Report.pdf')}</span>
                  </a>
                )}

                {outputObj && typeof outputObj.url === 'string' && node.kind === 's3' && (
                  <div className="p-2.5 rounded-lg bg-[#F0FDFA] border border-[#CCFBF1] text-[12px] text-[#0F766E] flex items-center justify-between gap-2">
                    <span className="truncate">{String(outputObj.key)}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </div>
                )}

                <pre className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-[11px] font-mono-code text-[#1E293B] overflow-x-auto max-h-[420px] leading-relaxed">
                  {JSON.stringify(runResult.output ?? null, null, 2)}
                </pre>
              </>
            )}
          </div>
        ) : (
          <>
            {/* START NODE TRIGGER SCENARIOS */}
            {node.kind === 'start' && (
              <div className="space-y-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-2">
                    Trigger Scenario
                  </div>
                  <div className="grid grid-cols-1 gap-1.5">
                    {[
                      { id: 'manual', label: 'Manual Run', desc: 'Execute via Run button or API', icon: Play },
                      { id: 'schedule', label: 'Scheduled (Cron)', desc: 'Run automatically on cron timer', icon: CalendarClock },
                      { id: 'webhook', label: 'On Event Hit (API Trigger)', desc: 'Invoke via HTTP webhook endpoint', icon: Webhook },
                      { id: 'chat', label: 'On Chat Start', desc: 'Start workflow from chat message', icon: MessageSquare },
                      { id: 'ingest', label: 'On Data Ingest', desc: 'Trigger when Ingest API receives data', icon: Zap },
                    ].map((opt) => {
                      const Icon = opt.icon;
                      const selected = triggerType === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => onUpdateTrigger(opt.id as TriggerType, triggerConfig, isActive)}
                          className={`w-full px-3 py-2 rounded-lg border text-left flex items-center gap-2.5 transition-colors ${
                            selected
                              ? 'border-[#312E81] bg-[#EEF2FF]/60'
                              : 'border-[#E2E8F0] hover:bg-[#F8FAFC]'
                          }`}
                        >
                          <Icon className={`w-4 h-4 shrink-0 ${selected ? 'text-[#4B4DED]' : 'text-[#64748B]'}`} />
                          <div className="min-w-0">
                            <div className="text-[12.5px] font-semibold text-[#0F172A]">{opt.label}</div>
                            <div className="text-[11px] text-[#64748B] truncate">{opt.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {triggerType === 'manual' && (
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1.5">
                      Initial Input Payload (JSON)
                    </label>
                    <textarea
                      rows={4}
                      value={triggerConfig.manualPayloadJson || '{}'}
                      onChange={(e) =>
                        onUpdateTrigger('manual', {
                          ...triggerConfig,
                          manualPayloadJson: e.target.value,
                        })
                      }
                      className="w-full p-2.5 text-[11.5px] font-mono-code bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4B4DED]"
                    />
                  </div>
                )}

                {triggerType === 'schedule' && (
                  <div className="space-y-2.5">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                      Cron Expression
                    </label>
                    <input
                      type="text"
                      value={triggerConfig.cronExpression || '0 */6 * * *'}
                      onChange={(e) =>
                        onUpdateTrigger('schedule', {
                          ...triggerConfig,
                          cronExpression: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 text-[12.5px] font-mono-code border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4B4DED]"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: 'Every 5m', expr: '*/5 * * * *' },
                        { label: 'Hourly', expr: '0 * * * *' },
                        { label: 'Daily 08:00', expr: '0 8 * * *' },
                      ].map((preset) => (
                        <button
                          key={preset.expr}
                          type="button"
                          onClick={() =>
                            onUpdateTrigger('schedule', {
                              ...triggerConfig,
                              cronExpression: preset.expr,
                            })
                          }
                          className="px-2 py-1 text-[11px] border border-[#E2E8F0] rounded-md hover:bg-[#F8FAFC] text-[#334155]"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {triggerType === 'webhook' && (
                  <div className="space-y-2.5">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                      Event Hit Webhook URL
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={webhookUrl}
                        className="flex-1 px-2.5 py-1.5 text-[11.5px] font-mono-code bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg text-[#334155]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(webhookUrl);
                          setCopiedWebhook(true);
                          setTimeout(() => setCopiedWebhook(false), 1800);
                        }}
                        className="px-2.5 py-1.5 border border-[#E2E8F0] rounded-lg hover:bg-[#F8FAFC] text-[#334155]"
                      >
                        {copiedWebhook ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-[#64748B]">
                      Send POST JSON to this URL to invoke the workflow immediately.
                    </p>
                  </div>
                )}

                {triggerType === 'chat' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1.5">
                        Chat Welcome Message
                      </label>
                      <input
                        type="text"
                        value={triggerConfig.chatWelcomeMessage || ''}
                        onChange={(e) =>
                          onUpdateTrigger('chat', {
                            ...triggerConfig,
                            chatWelcomeMessage: e.target.value,
                          })
                        }
                        placeholder="Ask a question to start this workflow..."
                        className="w-full px-3 py-2 text-[12.5px] border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4B4DED]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={onOpenChatRunner}
                      className="w-full py-2 px-3 bg-[#4B4DED] hover:bg-[#4338CA] text-white text-[12.5px] font-medium rounded-lg flex items-center justify-center gap-2"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>Open Chat Trigger Console</span>
                    </button>
                  </div>
                )}

                {triggerType === 'ingest' && (
                  <div className="space-y-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                      Ingest Stream Filter
                    </label>
                    <input
                      type="text"
                      value={triggerConfig.ingestStreamFilter || 'weather'}
                      onChange={(e) =>
                        onUpdateTrigger('ingest', {
                          ...triggerConfig,
                          ingestStreamFilter: e.target.value,
                        })
                      }
                      placeholder="weather (or * for all streams)"
                      className="w-full px-3 py-2 text-[12.5px] font-mono-code border border-[#E2E8F0] rounded-lg focus:outline-none focus:border-[#4B4DED]"
                    />
                    <p className="text-[11px] text-[#64748B]">
                      Workflow fires automatically when external systems post to <code>/api/ingest/events</code> matching this stream.
                    </p>
                  </div>
                )}

                <label className="flex items-center justify-between pt-2 border-t border-[#F1F5F9] text-[12.5px] text-[#334155] cursor-pointer">
                  <span>Workflow Active</span>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => onUpdateTrigger(triggerType, triggerConfig, e.target.checked)}
                    className="w-4 h-4 accent-[#4B4DED]"
                  />
                </label>
              </div>
            )}

            {/* INPUT PARAMETERS TABLE (matches Screenshot 1: latestHistoricalTemp | Number[] + Add Row) */}
            {node.kind !== 'start' && (
              <div>
                <div className="space-y-2">
                  {node.inputs.map((inp) => (
                    <div key={inp.id} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={inp.name}
                        onChange={(e) => handleUpdateInputRow(inp.id, 'name', e.target.value)}
                        className="flex-1 min-w-0 px-2.5 py-1.5 text-[12px] text-[#0F172A] border border-[#DCE2EC] rounded-[6px] focus:outline-none focus:border-[#4B4DED]"
                      />
                      <input
                        type="text"
                        value={inp.type}
                        onChange={(e) => handleUpdateInputRow(inp.id, 'type', e.target.value)}
                        className="w-[82px] px-2.5 py-1.5 text-[12px] text-[#334155] border border-[#DCE2EC] rounded-[6px] focus:outline-none focus:border-[#4B4DED]"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveInputRow(inp.id)}
                        className="p-1 text-[#94A3B8] hover:text-[#DC2626]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleAddInputRow}
                    className="flex items-center gap-1.5 text-[12px] font-medium text-[#334155] hover:text-[#0F172A] pt-0.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Row</span>
                  </button>
                </div>
              </div>
            )}

            {/* SQL NODE CONFIG (matches Screenshot 1: CONNECTIONS -> Northwinds DB, CODE -> SQL) */}
            {node.kind === 'sql' && (
              <>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                      CONNECTIONS
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenVault('sql_datasource')}
                      className="text-[11px] font-medium text-[#4B4DED] hover:underline"
                    >
                      Manage
                    </button>
                  </div>
                  <select
                    value={node.config.connectionId || ''}
                    onChange={(e) => {
                      const chosen = sqlConnections.find((c) => c.id === e.target.value);
                      onUpdateNode(node.id, (prev) => ({
                        ...prev,
                        config: {
                          ...prev.config,
                          connectionId: chosen?.id,
                          connectionName: chosen?.name || 'Northwinds DB',
                        },
                      }));
                    }}
                    className="w-full px-3 py-2 text-[13px] font-medium text-[#0F172A] bg-white border border-[#DCE2EC] rounded-[8px] focus:outline-none focus:border-[#4B4DED]"
                  >
                    {sqlConnections.length === 0 && (
                      <option value="">Northwinds DB</option>
                    )}
                    {sqlConnections.map((conn) => (
                      <option key={conn.id} value={conn.id}>
                        {conn.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                      CODE
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingCode((v) => !v)}
                      className="text-[11px] font-medium text-[#4B4DED] hover:underline"
                    >
                      {editingCode ? 'Preview' : 'Edit SQL'}
                    </button>
                  </div>
                  {editingCode ? (
                    <textarea
                      rows={6}
                      value={node.config.query || ''}
                      onChange={(e) =>
                        onUpdateNode(node.id, (prev) => ({
                          ...prev,
                          config: { ...prev.config, query: e.target.value },
                        }))
                      }
                      className="w-full p-2.5 text-[11.5px] font-mono-code bg-[#F8FAFC] border border-[#4B4DED] rounded-[8px] focus:outline-none"
                    />
                  ) : (
                    <div
                      onClick={() => setEditingCode(true)}
                      className="p-2.5 rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0] cursor-text"
                    >
                      <SyntaxCodeBlock code={node.config.query || ''} language="sql" />
                    </div>
                  )}
                </div>
              </>
            )}

            {/* REST NODE CONFIG */}
            {node.kind === 'rest' && (
              <div className="space-y-3">
                <div className="grid grid-cols-[90px_1fr] gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                      METHOD
                    </label>
                    <select
                      value={node.config.method || 'GET'}
                      onChange={(e) =>
                        onUpdateNode(node.id, (prev) => ({
                          ...prev,
                          config: {
                            ...prev.config,
                            method: e.target.value as WorkflowNode['config']['method'],
                          },
                        }))
                      }
                      className="w-full px-2.5 py-2 text-[12.5px] font-semibold bg-white border border-[#DCE2EC] rounded-[8px]"
                    >
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                      ENDPOINT URL
                    </label>
                    <input
                      type="url"
                      value={node.config.url || ''}
                      onChange={(e) =>
                        onUpdateNode(node.id, (prev) => ({
                          ...prev,
                          config: { ...prev.config, url: e.target.value },
                        }))
                      }
                      placeholder="https://api.example.com/v1/data"
                      className="w-full px-2.5 py-2 text-[12px] font-mono-code bg-white border border-[#DCE2EC] rounded-[8px]"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                      EXTERNAL AUTH
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenVault('rest_auth')}
                      className="text-[11px] font-medium text-[#4B4DED] hover:underline"
                    >
                      Manage Auth
                    </button>
                  </div>
                  <select
                    value={node.config.restAuthId || ''}
                    onChange={(e) =>
                      onUpdateNode(node.id, (prev) => ({
                        ...prev,
                        config: { ...prev.config, restAuthId: e.target.value || undefined },
                      }))
                    }
                    className="w-full px-3 py-2 text-[12.5px] bg-white border border-[#DCE2EC] rounded-[8px]"
                  >
                    <option value="">None (Public Endpoint)</option>
                    {restAuths.map((auth) => (
                      <option key={auth.id} value={auth.id}>
                        {auth.name} ({auth.provider})
                      </option>
                    ))}
                  </select>
                </div>

                {node.config.method && node.config.method !== 'GET' && (
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                      JSON BODY
                    </label>
                    <textarea
                      rows={4}
                      value={node.config.body || ''}
                      onChange={(e) =>
                        onUpdateNode(node.id, (prev) => ({
                          ...prev,
                          config: { ...prev.config, body: e.target.value },
                        }))
                      }
                      placeholder='{"key": "{{input}}"}'
                      className="w-full p-2.5 text-[11.5px] font-mono-code bg-[#F8FAFC] border border-[#DCE2EC] rounded-[8px]"
                    />
                  </div>
                )}
              </div>
            )}

            {/* JAVASCRIPT NODE CONFIG */}
            {node.kind === 'javascript' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                    CODE (SANDBOXED JS)
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingCode((v) => !v)}
                    className="text-[11px] font-medium text-[#4B4DED] hover:underline"
                  >
                    {editingCode ? 'Preview' : 'Edit JS'}
                  </button>
                </div>
                {editingCode ? (
                  <textarea
                    rows={9}
                    value={node.config.code || ''}
                    onChange={(e) =>
                      onUpdateNode(node.id, (prev) => ({
                        ...prev,
                        config: { ...prev.config, code: e.target.value },
                      }))
                    }
                    className="w-full p-2.5 text-[11.5px] font-mono-code bg-[#F8FAFC] border border-[#4B4DED] rounded-[8px] focus:outline-none"
                  />
                ) : (
                  <div
                    onClick={() => setEditingCode(true)}
                    className="p-2.5 rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0] cursor-text"
                  >
                    <SyntaxCodeBlock code={node.config.code || ''} language="javascript" />
                  </div>
                )}
              </div>
            )}

            {/* AI / LLM NODE CONFIG */}
            {node.kind === 'ai' && (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                      AI PROVIDER
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenVault('ai_provider')}
                      className="text-[11px] font-medium text-[#4B4DED] hover:underline"
                    >
                      Custom Provider
                    </button>
                  </div>
                  <select
                    value={node.config.aiProviderId || ''}
                    onChange={(e) =>
                      onUpdateNode(node.id, (prev) => ({
                        ...prev,
                        config: { ...prev.config, aiProviderId: e.target.value || undefined },
                      }))
                    }
                    className="w-full px-3 py-2 text-[12.5px] bg-white border border-[#DCE2EC] rounded-[8px]"
                  >
                    <option value="">Built-in Gemini AI (Server-side)</option>
                    {aiProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.provider})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                    MODEL
                  </label>
                  <select
                    value={node.config.model || 'gemini-4-hydrogen'}
                    onChange={(e) =>
                      onUpdateNode(node.id, (prev) => ({
                        ...prev,
                        config: { ...prev.config, model: e.target.value },
                      }))
                    }
                    className="w-full px-3 py-2 text-[12.5px] bg-white border border-[#DCE2EC] rounded-[8px]"
                  >
                    <option value="gemini-4-hydrogen">gemini-4-hydrogen (Fast Reasoning)</option>
                    <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Ultra Low Latency)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                    PROMPT TEMPLATE
                  </label>
                  <textarea
                    rows={4}
                    value={node.config.prompt || ''}
                    onChange={(e) =>
                      onUpdateNode(node.id, (prev) => ({
                        ...prev,
                        config: { ...prev.config, prompt: e.target.value },
                      }))
                    }
                    className="w-full p-2.5 text-[12px] bg-[#F8FAFC] border border-[#DCE2EC] rounded-[8px]"
                  />
                </div>
              </div>
            )}

            {/* CONDITION NODE CONFIG */}
            {node.kind === 'condition' && (
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                  BRANCH EXPRESSION (TRUE → 1, FALSE → 2)
                </label>
                <textarea
                  rows={3}
                  value={node.config.expression || ''}
                  onChange={(e) =>
                    onUpdateNode(node.id, (prev) => ({
                      ...prev,
                      config: { ...prev.config, expression: e.target.value },
                    }))
                  }
                  className="w-full p-2.5 text-[11.5px] font-mono-code bg-[#F8FAFC] border border-[#DCE2EC] rounded-[8px]"
                />
              </div>
            )}

            {/* ALERT NODE CONFIG */}
            {node.kind === 'alert' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                    ALERT TITLE
                  </label>
                  <input
                    type="text"
                    value={node.config.alertTitle || ''}
                    onChange={(e) =>
                      onUpdateNode(node.id, (prev) => ({
                        ...prev,
                        config: { ...prev.config, alertTitle: e.target.value },
                      }))
                    }
                    className="w-full px-3 py-2 text-[12.5px] border border-[#DCE2EC] rounded-[8px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                    TRIGGER CONDITION (JS)
                  </label>
                  <textarea
                    rows={3}
                    value={node.config.alertCondition || ''}
                    onChange={(e) =>
                      onUpdateNode(node.id, (prev) => ({
                        ...prev,
                        config: { ...prev.config, alertCondition: e.target.value },
                      }))
                    }
                    className="w-full p-2.5 text-[11.5px] font-mono-code bg-[#F8FAFC] border border-[#DCE2EC] rounded-[8px]"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                      WEBHOOK CHANNEL
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenVault('alert_channel')}
                      className="text-[11px] font-medium text-[#4B4DED] hover:underline"
                    >
                      Manage
                    </button>
                  </div>
                  <select
                    value={node.config.alertChannelId || ''}
                    onChange={(e) =>
                      onUpdateNode(node.id, (prev) => ({
                        ...prev,
                        config: { ...prev.config, alertChannelId: e.target.value || undefined },
                      }))
                    }
                    className="w-full px-3 py-2 text-[12.5px] bg-white border border-[#DCE2EC] rounded-[8px]"
                  >
                    <option value="">In-App Realtime Socket Alert Only</option>
                    {alertChannels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* EXPORT TO PDF NODE CONFIG */}
            {node.kind === 'pdf' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                    REPORT TITLE
                  </label>
                  <input
                    type="text"
                    value={node.config.pdfTitle || ''}
                    onChange={(e) =>
                      onUpdateNode(node.id, (prev) => ({
                        ...prev,
                        config: { ...prev.config, pdfTitle: e.target.value },
                      }))
                    }
                    className="w-full px-3 py-2 text-[12.5px] border border-[#DCE2EC] rounded-[8px]"
                  />
                </div>
              </div>
            )}

            {/* UPLOAD TO S3 NODE CONFIG */}
            {node.kind === 's3' && (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                      S3 STORAGE BUCKET
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenVault('s3_storage')}
                      className="text-[11px] font-medium text-[#4B4DED] hover:underline"
                    >
                      Configure S3
                    </button>
                  </div>
                  <select
                    value={node.config.s3CredentialId || ''}
                    onChange={(e) =>
                      onUpdateNode(node.id, (prev) => ({
                        ...prev,
                        config: { ...prev.config, s3CredentialId: e.target.value || undefined },
                      }))
                    }
                    className="w-full px-3 py-2 text-[12.5px] bg-white border border-[#DCE2EC] rounded-[8px]"
                  >
                    <option value="">Select S3-compatible credential...</option>
                    {s3Stores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({String(s.publicConfig.bucket || s.provider)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                    OBJECT KEY PREFIX
                  </label>
                  <input
                    type="text"
                    value={node.config.s3KeyPrefix || 'wirelogic-exports/'}
                    onChange={(e) =>
                      onUpdateNode(node.id, (prev) => ({
                        ...prev,
                        config: { ...prev.config, s3KeyPrefix: e.target.value },
                      }))
                    }
                    className="w-full px-3 py-2 text-[12.5px] font-mono-code border border-[#DCE2EC] rounded-[8px]"
                  />
                </div>
              </div>
            )}

            {/* SETTINGS SECTION (matches Screenshot 1: Loop, Lock, Cache -> TTL) */}
            {node.kind !== 'start' && (
              <div className="pt-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B] mb-2">
                  SETTINGS
                </div>
                <div className="divide-y divide-[#F1F5F9] border-t border-b border-[#F1F5F9]">
                  <label className="py-2.5 flex items-center justify-between text-[13px] font-medium text-[#0F172A] cursor-pointer">
                    <span>Loop</span>
                    <input
                      type="checkbox"
                      checked={Boolean(node.config.loop)}
                      onChange={(e) =>
                        onUpdateNode(node.id, (prev) => ({
                          ...prev,
                          config: { ...prev.config, loop: e.target.checked },
                        }))
                      }
                      className="w-4 h-4 accent-[#4B4DED]"
                    />
                  </label>

                  <label className="py-2.5 flex items-center justify-between text-[13px] font-medium text-[#0F172A] cursor-pointer">
                    <span>Lock</span>
                    <input
                      type="checkbox"
                      checked={Boolean(node.config.lock)}
                      onChange={(e) =>
                        onUpdateNode(node.id, (prev) => ({
                          ...prev,
                          config: { ...prev.config, lock: e.target.checked },
                        }))
                      }
                      className="w-4 h-4 accent-[#4B4DED]"
                    />
                  </label>

                  <div className="py-2.5 space-y-2">
                    <label className="flex items-center justify-between text-[13px] font-medium text-[#0F172A] cursor-pointer">
                      <span>Cache</span>
                      <input
                        type="checkbox"
                        checked={Boolean(node.config.cacheEnabled)}
                        onChange={(e) =>
                          onUpdateNode(node.id, (prev) => ({
                            ...prev,
                            config: { ...prev.config, cacheEnabled: e.target.checked },
                          }))
                        }
                        className="w-4 h-4 accent-[#4B4DED]"
                      />
                    </label>
                    <div className="flex items-center justify-between px-3 py-1.5 border border-[#DCE2EC] rounded-[8px]">
                      <span className="text-[12.5px] text-[#334155]">TTL</span>
                      <input
                        type="number"
                        min={0}
                        value={node.config.cacheTtl ?? 300}
                        onChange={(e) =>
                          onUpdateNode(node.id, (prev) => ({
                            ...prev,
                            config: { ...prev.config, cacheTtl: Number(e.target.value) },
                          }))
                        }
                        className="w-20 text-right text-[12.5px] font-mono-code text-[#0F172A] focus:outline-none tabular-nums"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
