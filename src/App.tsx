import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart2,
  Bell,
  BookOpen,
  ChevronRight,
  Clock,
  Database,
  FileText,
  History,
  Key,
  Loader2,
  LogOut,
  MoreVertical,
  PanelLeft,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Workflow as WorkflowIcon,
  X,
} from 'lucide-react';
import type { Socket } from 'socket.io-client';
import { AuthView } from './components/AuthView';
import { CredentialsVaultModal } from './components/CredentialsVaultModal';
import { ExecutionsDrawer } from './components/ExecutionsDrawer';
import { FunctionPicker } from './components/FunctionPicker';
import { IngestApiPanel } from './components/IngestApiPanel';
import { NodeInspector } from './components/NodeInspector';
import { buildDefaultNode, type FunctionCatalogItem } from './components/NodeMeta';
import { WorkflowCanvas } from './components/WorkflowCanvas';
import { apiFetch, createRealtimeSocket, setAuthToken } from './lib/api';
import type {
  ApiKeyRecord,
  ArtifactRecord,
  AuthUser,
  CredentialCategory,
  CredentialRecord,
  IngestedEventRecord,
  NodeExecutionResult,
  TriggerConfig,
  TriggerType,
  WorkflowEdge,
  WorkflowExecutionRecord,
  WorkflowNode,
  WorkflowRecord,
} from './shared/types';

function formatRelativeUpdated(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return 'just now';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Core data states
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [activeWorkflowId, setActiveWorkflowId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<CredentialRecord[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [ingestedEvents, setIngestedEvents] = useState<IngestedEventRecord[]>([]);
  const [executions, setExecutions] = useState<WorkflowExecutionRecord[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);

  // Editor & UI states
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('sql_weather');
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [isRunningWorkflow, setIsRunningWorkflow] = useState(false);
  const [nodeRunStates, setNodeRunStates] = useState<Record<string, NodeExecutionResult>>({});
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Undo / Redo stacks for nodes & edges
  const [undoStack, setUndoStack] = useState<
    Array<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] }>
  >([]);
  const [redoStack, setRedoStack] = useState<
    Array<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] }>
  >([]);

  // Popovers & Modals
  const [pickerState, setPickerState] = useState<{
    sourceNodeId: string | null;
    position: { x: number; y: number };
  } | null>(null);
  const [vaultModal, setVaultModal] = useState<{
    open: boolean;
    category: CredentialCategory;
  }>({ open: false, category: 'sql_datasource' });
  const [ingestModalOpen, setIngestModalOpen] = useState(false);
  const [executionsDrawer, setExecutionsDrawer] = useState<{
    open: boolean;
    mode: 'history' | 'chat';
  }>({ open: false, mode: 'history' });
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [liveAlerts, setLiveAlerts] = useState<
    Array<{ id: string; title: string; severity: string; timestamp: string }>
  >([]);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const activeWorkflow = workflows.find((w) => w.id === activeWorkflowId) || workflows[0] || null;

  const showToast = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    const [wfRes, credRes, keyRes, feedRes, artRes] = await Promise.all([
      apiFetch<{ workflows: WorkflowRecord[] }>('/api/workflows'),
      apiFetch<{ credentials: CredentialRecord[] }>('/api/credentials'),
      apiFetch<{ keys: ApiKeyRecord[] }>('/api/keys'),
      apiFetch<{ events: IngestedEventRecord[] }>('/api/ingest/feed'),
      apiFetch<{ artifacts: ArtifactRecord[] }>('/api/artifacts'),
    ]);

    setWorkflows(wfRes.workflows);
    setCredentials(credRes.credentials);
    setApiKeys(keyRes.keys);
    setIngestedEvents(feedRes.events);
    setArtifacts(artRes.artifacts);

    if (wfRes.workflows.length > 0) {
      const first = wfRes.workflows[0];
      setActiveWorkflowId((prev) => prev || first.id);
      if (first.nodes.some((n) => n.id === 'sql_weather')) {
        setSelectedNodeId('sql_weather');
      } else if (first.nodes[0]) {
        setSelectedNodeId(first.nodes[0].id);
      }
      const exRes = await apiFetch<{ executions: WorkflowExecutionRecord[] }>(
        `/api/workflows/${first.id}/executions`
      );
      setExecutions(exRes.executions);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadWorkspaceData();

    const socket = createRealtimeSocket(token);
    socketRef.current = socket;

    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));

    socket.on('ingest:received', (ev: IngestedEventRecord) => {
      setIngestedEvents((prev) => [ev, ...prev].slice(0, 100));
    });

    socket.on('execution:started', (data: { workflowId: string }) => {
      if (data.workflowId === activeWorkflowId) {
        setNodeRunStates({});
      }
    });

    socket.on('execution:node:running', (data: { nodeId: string }) => {
      setNodeRunStates((prev) => ({
        ...prev,
        [data.nodeId]: {
          ...(prev[data.nodeId] || { nodeId: data.nodeId, nodeTitle: '', kind: 'sql' }),
          status: 'running',
        },
      }));
    });

    socket.on(
      'execution:node:completed',
      (data: { nodeId: string; result: NodeExecutionResult }) => {
        setNodeRunStates((prev) => ({
          ...prev,
          [data.nodeId]: data.result,
        }));
      }
    );

    socket.on('execution:node:error', (data: { nodeId: string; error: string }) => {
      setNodeRunStates((prev) => ({
        ...prev,
        [data.nodeId]: {
          ...(prev[data.nodeId] || { nodeId: data.nodeId, nodeTitle: '', kind: 'sql' }),
          status: 'failed',
          error: data.error,
        },
      }));
    });

    socket.on(
      'execution:completed',
      (data: { workflowId: string; status: string; error?: string }) => {
        setIsRunningWorkflow(false);
        if (data.status === 'failed' && data.error) {
          showToast('err', data.error);
        } else {
          showToast('ok', 'Workflow execution completed.');
        }
        void apiFetch<{ executions: WorkflowExecutionRecord[] }>(
          `/api/workflows/${data.workflowId}/executions`
        ).then((r) => setExecutions(r.executions));
        void apiFetch<{ artifacts: ArtifactRecord[] }>('/api/artifacts').then((r) =>
          setArtifacts(r.artifacts)
        );
      }
    );

    socket.on(
      'alert:triggered',
      (alert: { executionId: string; title: string; severity: string; timestamp: string }) => {
        setLiveAlerts((prev) => [
          {
            id: `${alert.executionId}_${Date.now()}`,
            title: alert.title,
            severity: alert.severity,
            timestamp: alert.timestamp,
          },
          ...prev,
        ]);
        showToast('ok', `Alert triggered: ${alert.title}`);
      }
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token, loadWorkspaceData, activeWorkflowId, showToast]);

  const saveTimerRef = useRef<number | null>(null);
  const persistWorkflow = useCallback((wf: WorkflowRecord) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void apiFetch<{ workflow: WorkflowRecord }>(`/api/workflows/${wf.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: wf.name,
          description: wf.description,
          triggerType: wf.triggerType,
          triggerConfig: wf.triggerConfig,
          nodes: wf.nodes,
          edges: wf.edges,
          isActive: wf.isActive,
        }),
      }).then((res) => {
        setWorkflows((prev) => prev.map((w) => (w.id === res.workflow.id ? res.workflow : w)));
      });
    }, 450);
  }, []);

  const mutateActiveWorkflow = useCallback(
    (updater: (wf: WorkflowRecord) => WorkflowRecord, recordHistory = true) => {
      if (!activeWorkflow) return;
      if (recordHistory) {
        setUndoStack((prev) =>
          [...prev, { nodes: activeWorkflow.nodes, edges: activeWorkflow.edges }].slice(-25)
        );
        setRedoStack([]);
      }
      const next = updater(activeWorkflow);
      setWorkflows((prev) => prev.map((w) => (w.id === next.id ? next : w)));
      persistWorkflow(next);
    },
    [activeWorkflow, persistWorkflow]
  );

  const handleMoveNode = useCallback(
    (nodeId: string, x: number, y: number, commit = false) => {
      if (!activeWorkflow) return;
      if (commit) {
        setUndoStack((prev) =>
          [...prev, { nodes: activeWorkflow.nodes, edges: activeWorkflow.edges }].slice(-25)
        );
        setRedoStack([]);
      }
      const next: WorkflowRecord = {
        ...activeWorkflow,
        nodes: activeWorkflow.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)),
      };
      setWorkflows((prev) => prev.map((w) => (w.id === next.id ? next : w)));
      if (commit) {
        persistWorkflow(next);
      }
    },
    [activeWorkflow, persistWorkflow]
  );

  const handleUndo = useCallback(() => {
    if (!activeWorkflow || undoStack.length === 0) return;
    const prevSnapshot = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((r) => [...r, { nodes: activeWorkflow.nodes, edges: activeWorkflow.edges }]);
    mutateActiveWorkflow(
      (wf) => ({ ...wf, nodes: prevSnapshot.nodes, edges: prevSnapshot.edges }),
      false
    );
  }, [activeWorkflow, undoStack, mutateActiveWorkflow]);

  const handleRedo = useCallback(() => {
    if (!activeWorkflow || redoStack.length === 0) return;
    const nextSnapshot = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((s) => [...s, { nodes: activeWorkflow.nodes, edges: activeWorkflow.edges }]);
    mutateActiveWorkflow(
      (wf) => ({ ...wf, nodes: nextSnapshot.nodes, edges: nextSnapshot.edges }),
      false
    );
  }, [activeWorkflow, redoStack, mutateActiveWorkflow]);

  function handleSelectFunctionFromPicker(item: FunctionCatalogItem) {
    if (!activeWorkflow) return;
    const sourceNode = pickerState?.sourceNodeId
      ? activeWorkflow.nodes.find((n) => n.id === pickerState.sourceNodeId)
      : null;

    const x = sourceNode ? sourceNode.x + 280 : 320;
    const siblingCount = sourceNode
      ? activeWorkflow.edges.filter((e) => e.source === sourceNode.id).length
      : 0;
    const y = sourceNode ? sourceNode.y + siblingCount * 165 : 220;

    const defaultSql = credentials.find((c) => c.category === 'sql_datasource');
    const newNode = buildDefaultNode(
      item,
      x,
      y,
      defaultSql ? { id: defaultSql.id, name: defaultSql.name } : undefined
    );

    const newEdges = [...activeWorkflow.edges];
    if (sourceNode) {
      newEdges.push({
        id: `e_${Date.now().toString(36)}`,
        source: sourceNode.id,
        target: newNode.id,
        badgeText: String(siblingCount + 1),
        branch: siblingCount + 1,
      });
    }

    mutateActiveWorkflow((wf) => ({
      ...wf,
      nodes: [...wf.nodes, newNode],
      edges: newEdges,
    }));
    setSelectedNodeId(newNode.id);
    setInspectorCollapsed(false);
    setPickerState(null);
  }

  async function handleRunWorkflow(singleNodeId?: string, overridePayload?: Record<string, unknown>) {
    if (!activeWorkflow) return;
    setIsRunningWorkflow(true);
    setNodeRunStates({});
    try {
      let payload: Record<string, unknown> = overridePayload || {};
      if (!overridePayload && activeWorkflow.triggerType === 'manual') {
        try {
          payload = JSON.parse(activeWorkflow.triggerConfig?.manualPayloadJson || '{}');
        } catch {
          payload = {};
        }
      }
      const res = await apiFetch<{ execution: WorkflowExecutionRecord }>(
        `/api/workflows/${activeWorkflow.id}/run`,
        {
          method: 'POST',
          body: JSON.stringify({
            payload,
            singleNodeId,
            triggerType: overridePayload ? 'chat' : activeWorkflow.triggerType,
          }),
        }
      );
      setNodeRunStates(res.execution.nodeResults || {});
      setExecutions((prev) => [res.execution, ...prev]);
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setIsRunningWorkflow(false);
    }
  }

  async function handleCreateWorkflow() {
    const res = await apiFetch<{ workflow: WorkflowRecord }>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({ name: `Workflow ${workflows.length + 1}` }),
    });
    setWorkflows((prev) => [res.workflow, ...prev]);
    setActiveWorkflowId(res.workflow.id);
    setSelectedNodeId(res.workflow.nodes[0]?.id || null);
    setNodeRunStates({});
    setSidebarOpen(false);
  }

  async function handleDeleteWorkflow(id: string) {
    if (workflows.length <= 1) {
      showToast('err', 'At least one workflow is required.');
      return;
    }
    await apiFetch(`/api/workflows/${id}`, { method: 'DELETE' });
    const remaining = workflows.filter((w) => w.id !== id);
    setWorkflows(remaining);
    if (activeWorkflowId === id && remaining[0]) {
      setActiveWorkflowId(remaining[0].id);
      setSelectedNodeId(remaining[0].nodes[0]?.id || null);
    }
  }

  async function handleLogout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setWorkflows([]);
  }

  if (!user || !token) {
    return (
      <AuthView
        onAuthenticated={(u, t) => {
          setUser(u);
          setToken(t);
        }}
      />
    );
  }

  const selectedNode =
    activeWorkflow?.nodes.find((n) => n.id === selectedNodeId) || null;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#F6F8FB] overflow-hidden">
      {/* TOP BREADCRUMB BAR (exact match to Screenshots 1 & 2) */}
      <header className="h-11 bg-white border-b border-[#E5E7EB] px-3.5 flex items-center justify-between gap-4 shrink-0 z-30">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            title="Toggle workspace sidebar"
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 rounded-md text-[#64748B] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
          >
            <PanelLeft className="w-4 h-4" />
          </button>

          <nav className="flex items-center gap-1.5 text-[13px] min-w-0 truncate">
            <span className="text-[#64748B] whitespace-nowrap">WireLogic</span>
            <ChevronRight className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="text-[#64748B] hover:text-[#0F172A] whitespace-nowrap"
            >
              Workflows
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
            <span className="font-medium text-[#0F172A] truncate">
              {activeWorkflow?.name || 'Workflow'}
            </span>
          </nav>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            title="Search workflows & nodes"
            onClick={() => setSearchOpen((v) => !v)}
            className="p-1.5 rounded-md text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="Live Ingest Stream & API Keys"
            onClick={() => setIngestModalOpen(true)}
            className="p-1.5 rounded-md text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
          >
            <BarChart2 className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              type="button"
              title="Alerts & Notifications"
              onClick={() => setAlertsOpen((v) => !v)}
              className="p-1.5 rounded-md text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors relative"
            >
              <Bell className="w-4 h-4" />
              {liveAlerts.length > 0 && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[#DC2626]" />
              )}
            </button>
            {alertsOpen && (
              <div className="absolute right-0 mt-1.5 w-72 bg-white border border-[#DCE2EC] rounded-xl shadow-xl p-3 z-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12.5px] font-semibold text-[#0F172A]">
                    Live Alerts ({liveAlerts.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setLiveAlerts([])}
                    className="text-[11px] text-[#64748B] hover:text-[#0F172A]"
                  >
                    Clear
                  </button>
                </div>
                {liveAlerts.length === 0 ? (
                  <p className="text-[12px] text-[#64748B] py-3 text-center">
                    No alerts triggered in this session.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto">
                    {liveAlerts.map((al) => (
                      <div key={al.id} className="p-2 rounded-lg bg-[#FEF2F2] text-[11.5px]">
                        <div className="font-semibold text-[#991B1B]">{al.title}</div>
                        <div className="text-[#B91C1C] tabular-nums">
                          {new Date(al.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* SUB-HEADER WORKFLOW TITLE BAR (exact match to Screenshots 1 & 2) */}
      {activeWorkflow && (
        <div className="h-[52px] bg-white border-b border-[#E5E7EB] px-4 sm:px-5 flex items-center justify-between gap-3 shrink-0 z-20">
          <div className="flex items-center gap-2 min-w-0">
            {editingTitle ? (
              <input
                type="text"
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  setEditingTitle(false);
                  if (titleDraft.trim() && titleDraft.trim() !== activeWorkflow.name) {
                    mutateActiveWorkflow((wf) => ({ ...wf, name: titleDraft.trim() }));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="text-[15px] font-semibold text-[#0F172A] px-2 py-0.5 border border-[#4B4DED] rounded-md focus:outline-none"
              />
            ) : (
              <>
                <h1 className="text-[15px] font-semibold text-[#0F172A] truncate">
                  {activeWorkflow.name}
                </h1>
                <button
                  type="button"
                  title="Rename workflow"
                  onClick={() => {
                    setTitleDraft(activeWorkflow.name);
                    setEditingTitle(true);
                  }}
                  className="p-1 text-[#94A3B8] hover:text-[#475569] rounded"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden md:flex items-center gap-1.5 text-[12.5px] text-[#64748B] tabular-nums mr-1">
              <Clock className="w-3.5 h-3.5 text-[#94A3B8]" />
              <span>Updated: {formatRelativeUpdated(activeWorkflow.updatedAt)}</span>
            </div>

            <button
              type="button"
              disabled={isRunningWorkflow}
              onClick={() => {
                if (activeWorkflow.triggerType === 'chat') {
                  setExecutionsDrawer({ open: true, mode: 'chat' });
                } else {
                  void handleRunWorkflow();
                }
              }}
              className="px-3.5 py-1.5 bg-[#4B4DED] hover:bg-[#4338CA] disabled:opacity-70 text-white text-[13px] font-medium rounded-[7px] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 shadow-xs"
            >
              {isRunningWorkflow ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>{isRunningWorkflow ? 'Running' : 'Run'}</span>
            </button>

            <button
              type="button"
              title="Execution history & artifacts"
              onClick={() => setExecutionsDrawer({ open: true, mode: 'history' })}
              className="w-8 h-8 border border-[#DCE2EC] bg-white hover:bg-[#F8FAFC] rounded-[7px] flex items-center justify-center text-[#475569] transition-colors"
            >
              <History className="w-4 h-4" />
            </button>

            <div className="relative">
              <button
                type="button"
                title="More workflow actions"
                onClick={() => setMoreMenuOpen((v) => !v)}
                className="w-8 h-8 border border-[#DCE2EC] bg-white hover:bg-[#F8FAFC] rounded-[7px] flex items-center justify-center text-[#475569] transition-colors"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {moreMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-52 bg-white border border-[#DCE2EC] rounded-xl shadow-xl py-1.5 z-50">
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setVaultModal({ open: true, category: 'sql_datasource' });
                    }}
                    className="w-full px-3.5 py-2 text-left text-[12.5px] text-[#334155] hover:bg-[#F8FAFC] flex items-center gap-2"
                  >
                    <Database className="w-3.5 h-3.5 text-[#4B4DED]" />
                    <span>Manage SQL &amp; Vault</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setIngestModalOpen(true);
                    }}
                    className="w-full px-3.5 py-2 text-left text-[12.5px] text-[#334155] hover:bg-[#F8FAFC] flex items-center gap-2"
                  >
                    <Key className="w-3.5 h-3.5 text-[#4B4DED]" />
                    <span>Ingest API Keys &amp; Stream</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setExecutionsDrawer({ open: true, mode: 'chat' });
                    }}
                    className="w-full px-3.5 py-2 text-left text-[12.5px] text-[#334155] hover:bg-[#F8FAFC] flex items-center gap-2"
                  >
                    <Play className="w-3.5 h-3.5 text-[#059669]" />
                    <span>Open Chat Trigger</span>
                  </button>
                  <a
                    href="/api/docs"
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setMoreMenuOpen(false)}
                    className="w-full px-3.5 py-2 text-left text-[12.5px] text-[#334155] hover:bg-[#F8FAFC] flex items-center gap-2"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-[#64748B]" />
                    <span>Swagger API Docs</span>
                  </a>
                  <div className="my-1 border-t border-[#F1F5F9]" />
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      void handleDeleteWorkflow(activeWorkflow.id);
                    }}
                    className="w-full px-3.5 py-2 text-left text-[12.5px] text-[#DC2626] hover:bg-[#FEF2F2] flex items-center gap-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Workflow</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MAIN BODY: COLLAPSIBLE SIDEBAR + CANVAS + FLOATING INSPECTOR */}
      <div className="flex-1 flex min-h-0 relative">
        {sidebarOpen && (
          <aside className="absolute md:static inset-y-0 left-0 z-40 w-64 bg-white border-r border-[#E5E7EB] flex flex-col justify-between shadow-lg md:shadow-none">
            <div className="p-3 space-y-4 overflow-y-auto">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                  Workflows
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title="New Workflow"
                    onClick={handleCreateWorkflow}
                    className="p-1 rounded hover:bg-[#F1F5F9] text-[#4B4DED]"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(false)}
                    className="p-1 rounded hover:bg-[#F1F5F9] text-[#64748B] md:hidden"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                {workflows.map((wf) => (
                  <button
                    key={wf.id}
                    type="button"
                    onClick={() => {
                      setActiveWorkflowId(wf.id);
                      setSelectedNodeId(wf.nodes[0]?.id || null);
                      setNodeRunStates({});
                      void apiFetch<{ executions: WorkflowExecutionRecord[] }>(
                        `/api/workflows/${wf.id}/executions`
                      ).then((r) => setExecutions(r.executions));
                      if (window.innerWidth < 768) setSidebarOpen(false);
                    }}
                    className={`w-full px-2.5 py-2 rounded-lg text-left text-[13px] font-medium flex items-center gap-2 transition-colors ${
                      wf.id === activeWorkflow?.id
                        ? 'bg-[#EEF2FF] text-[#312E81]'
                        : 'text-[#334155] hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <WorkflowIcon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{wf.name}</span>
                  </button>
                ))}
              </div>

              <div className="pt-3 border-t border-[#F1F5F9] space-y-1">
                <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                  Platform &amp; Security
                </div>
                <button
                  type="button"
                  onClick={() => setVaultModal({ open: true, category: 'sql_datasource' })}
                  className="w-full px-2.5 py-2 rounded-lg text-left text-[13px] text-[#334155] hover:bg-[#F8FAFC] flex items-center gap-2"
                >
                  <Database className="w-4 h-4 text-[#4B4DED]" />
                  <span>SQL &amp; Credential Vault</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIngestModalOpen(true)}
                  className="w-full px-2.5 py-2 rounded-lg text-left text-[13px] text-[#334155] hover:bg-[#F8FAFC] flex items-center gap-2"
                >
                  <Key className="w-4 h-4 text-[#059669]" />
                  <span>Ingest API Keys &amp; Feed</span>
                </button>
                <button
                  type="button"
                  onClick={() => setExecutionsDrawer({ open: true, mode: 'history' })}
                  className="w-full px-2.5 py-2 rounded-lg text-left text-[13px] text-[#334155] hover:bg-[#F8FAFC] flex items-center gap-2"
                >
                  <FileText className="w-4 h-4 text-[#0284C7]" />
                  <span>Runs &amp; PDF Artifacts</span>
                </button>
                <a
                  href="/api/docs"
                  target="_blank"
                  rel="noreferrer"
                  className="w-full px-2.5 py-2 rounded-lg text-left text-[13px] text-[#334155] hover:bg-[#F8FAFC] flex items-center gap-2"
                >
                  <BookOpen className="w-4 h-4 text-[#64748B]" />
                  <span>Swagger API Docs</span>
                </a>
              </div>
            </div>

            <div className="p-3 border-t border-[#E5E7EB] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-[#0F172A] truncate">
                  {user.name}
                </div>
                <div className="text-[11px] text-[#64748B] truncate">{user.email}</div>
              </div>
              <button
                type="button"
                title="Sign out"
                onClick={handleLogout}
                className="p-1.5 rounded-lg text-[#64748B] hover:bg-[#FEF2F2] hover:text-[#DC2626]"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </aside>
        )}

        {/* CANVAS VIEWPORT */}
        {activeWorkflow && (
          <div className="flex-1 relative min-w-0 flex">
            <WorkflowCanvas
              nodes={activeWorkflow.nodes}
              edges={activeWorkflow.edges}
              triggerType={activeWorkflow.triggerType}
              selectedNodeId={selectedNodeId}
              nodeRunStates={nodeRunStates}
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
              onSelectNode={(id) => {
                setSelectedNodeId(id);
              }}
              onMoveNode={handleMoveNode}
              onDeleteNode={(nodeId) => {
                if (nodeId === 'start') return;
                mutateActiveWorkflow((wf) => ({
                  ...wf,
                  nodes: wf.nodes.filter((n) => n.id !== nodeId),
                  edges: wf.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
                }));
                if (selectedNodeId === nodeId) setSelectedNodeId(null);
              }}
              onDeleteEdge={(edgeId) => {
                mutateActiveWorkflow((wf) => ({
                  ...wf,
                  edges: wf.edges.filter((e) => e.id !== edgeId),
                }));
              }}
              onRunSingleNode={(nodeId) => {
                void handleRunWorkflow(nodeId);
              }}
              onOpenFunctionPicker={(sourceNodeId, position) => {
                setPickerState({ sourceNodeId, position });
              }}
              onUndo={handleUndo}
              onRedo={handleRedo}
            />

            {/* FLOATING RIGHT NODE INSPECTOR */}
            <NodeInspector
              node={selectedNode}
              triggerType={activeWorkflow.triggerType}
              triggerConfig={activeWorkflow.triggerConfig}
              isActive={activeWorkflow.isActive}
              collapsed={inspectorCollapsed}
              credentials={credentials}
              runResult={selectedNode ? nodeRunStates[selectedNode.id] : undefined}
              onToggleCollapse={() => setInspectorCollapsed((v) => !v)}
              onUpdateNode={(nodeId, updater) => {
                mutateActiveWorkflow(
                  (wf) => ({
                    ...wf,
                    nodes: wf.nodes.map((n) => (n.id === nodeId ? updater(n) : n)),
                  }),
                  false
                );
              }}
              onUpdateTrigger={(triggerType: TriggerType, triggerConfig: TriggerConfig, isActive?: boolean) => {
                mutateActiveWorkflow((wf) => ({
                  ...wf,
                  triggerType,
                  triggerConfig,
                  isActive: isActive ?? wf.isActive,
                }));
              }}
              onRunNode={(nodeId) => {
                void handleRunWorkflow(nodeId);
              }}
              onDeleteNode={(nodeId) => {
                mutateActiveWorkflow((wf) => ({
                  ...wf,
                  nodes: wf.nodes.filter((n) => n.id !== nodeId),
                  edges: wf.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
                }));
                setSelectedNodeId(null);
              }}
              onOpenVault={(category) => {
                setVaultModal({ open: true, category: category || 'sql_datasource' });
              }}
              onOpenChatRunner={() => {
                setExecutionsDrawer({ open: true, mode: 'chat' });
              }}
            />
          </div>
        )}
      </div>

      {/* Quick Search Palette */}
      {searchOpen && activeWorkflow && (
        <div
          onClick={() => setSearchOpen(false)}
          className="fixed inset-0 z-50 bg-[#0F172A]/30 flex items-start justify-center pt-20 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-white border border-[#DCE2EC] rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-[#F1F5F9] flex items-center gap-2">
              <Search className="w-4 h-4 text-[#94A3B8]" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Jump to node in workflow..."
                className="flex-1 text-[13.5px] focus:outline-none"
              />
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {activeWorkflow.nodes
                .filter((n) => n.title.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      setSelectedNodeId(n.id);
                      setInspectorCollapsed(false);
                      setSearchOpen(false);
                    }}
                    className="w-full px-4 py-2 text-left text-[13px] hover:bg-[#F8FAFC] flex items-center justify-between"
                  >
                    <span className="font-medium text-[#0F172A]">{n.title}</span>
                    <span className="text-[11.5px] text-[#64748B] uppercase">{n.kind}</span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Search Functions Node Picker Popover */}
      <FunctionPicker
        position={pickerState?.position || null}
        onSelect={handleSelectFunctionFromPicker}
        onClose={() => setPickerState(null)}
      />

      {/* Credentials Vault Modal */}
      <CredentialsVaultModal
        open={vaultModal.open}
        initialCategory={vaultModal.category}
        credentials={credentials}
        onClose={() => setVaultModal((v) => ({ ...v, open: false }))}
        onRefresh={async () => {
          const res = await apiFetch<{ credentials: CredentialRecord[] }>('/api/credentials');
          setCredentials(res.credentials);
        }}
      />

      {/* Ingest API Keys & Live Stream Modal */}
      <IngestApiPanel
        open={ingestModalOpen}
        apiKeys={apiKeys}
        ingestedEvents={ingestedEvents}
        socketConnected={socketConnected}
        onClose={() => setIngestModalOpen(false)}
        onRefreshKeys={async () => {
          const res = await apiFetch<{ keys: ApiKeyRecord[] }>('/api/keys');
          setApiKeys(res.keys);
        }}
      />

      {/* Execution History, Artifacts & Chat Trigger Drawer */}
      <ExecutionsDrawer
        open={executionsDrawer.open}
        mode={executionsDrawer.mode}
        executions={executions}
        artifacts={artifacts}
        chatWelcome={activeWorkflow?.triggerConfig?.chatWelcomeMessage}
        onClose={() => setExecutionsDrawer((d) => ({ ...d, open: false }))}
        onRunWithChat={async (message) => {
          await handleRunWorkflow(undefined, {
            message,
            sessionId: `chat_${Date.now()}`,
            sentAt: new Date().toISOString(),
          });
        }}
      />

      {/* Floating Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium border ${
            toast.type === 'ok'
              ? 'bg-white border-[#BBF7D0] text-[#166534]'
              : 'bg-white border-[#FECACA] text-[#B91C1C]'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
