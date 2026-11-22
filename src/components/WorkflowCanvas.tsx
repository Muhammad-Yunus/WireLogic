import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Lock,
  Maximize2,
  MoreHorizontal,
  Play,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  Unlock,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  NodeExecutionResult,
  TriggerType,
  WorkflowEdge,
  WorkflowNode,
} from '../shared/types';
import { NodeBadgeIcon } from './NodeMeta';
import { SyntaxCodeBlock } from './SyntaxCodeBlock';

interface WorkflowCanvasProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  triggerType: TriggerType;
  selectedNodeId: string | null;
  nodeRunStates: Record<string, NodeExecutionResult>;
  canUndo: boolean;
  canRedo: boolean;
  onSelectNode: (nodeId: string | null) => void;
  onMoveNode: (nodeId: string, x: number, y: number, commit?: boolean) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onRunSingleNode: (nodeId: string) => void;
  onOpenFunctionPicker: (sourceNodeId: string | null, screenPos: { x: number; y: number }) => void;
  onUndo: () => void;
  onRedo: () => void;
}

function getNodeDimensions(node: WorkflowNode): { width: number; height: number } {
  if (node.kind === 'start') return { width: 102, height: 38 };
  if (node.kind === 'sql') return { width: 226, height: 152 };
  if (node.kind === 'rest') return { width: 226, height: 134 };
  if (node.kind === 'javascript') return { width: 226, height: 128 };
  if (node.kind === 'alert') return { width: 226, height: 96 };
  if (node.kind === 'pdf' || node.kind === 's3') return { width: 206, height: 42 };
  return { width: 220, height: 96 };
}

export function WorkflowCanvas({
  nodes,
  edges,
  triggerType,
  selectedNodeId,
  nodeRunStates,
  canUndo,
  canRedo,
  onSelectNode,
  onMoveNode,
  onDeleteNode,
  onDeleteEdge,
  onRunSingleNode,
  onOpenFunctionPicker,
  onUndo,
  onRedo,
}: WorkflowCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 32, y: 42 });
  const [locked, setLocked] = useState(false);
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);

  const dragState = useRef<{
    type: 'pan' | 'node';
    nodeId?: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  const handleFitView = useCallback(() => {
    if (!containerRef.current || nodes.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of nodes) {
      const dim = getNodeDimensions(n);
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + dim.width);
      maxY = Math.max(maxY, n.y + dim.height);
    }

    const contentW = Math.max(200, maxX - minX + 120);
    const contentH = Math.max(200, maxY - minY + 120);
    const fitZoom = Math.max(0.45, Math.min(1.05, Math.min(rect.width / contentW, rect.height / contentH)));
    setZoom(Number(fitZoom.toFixed(2)));
    setPan({
      x: Math.round((rect.width - contentW * fitZoom) / 2 - minX * fitZoom + 40),
      y: Math.round((rect.height - contentH * fitZoom) / 2 - minY * fitZoom + 40),
    });
  }, [nodes]);

  useEffect(() => {
    function handleWindowPointerMove(e: PointerEvent) {
      const ds = dragState.current;
      if (!ds) return;
      const dx = e.clientX - ds.startClientX;
      const dy = e.clientY - ds.startClientY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        ds.moved = true;
      }
      if (ds.type === 'pan') {
        setPan({ x: ds.origX + dx, y: ds.origY + dy });
      } else if (ds.type === 'node' && ds.nodeId) {
        onMoveNode(
          ds.nodeId,
          Math.round(ds.origX + dx / zoom),
          Math.round(ds.origY + dy / zoom),
          false
        );
      }
    }

    function handleWindowPointerUp(e: PointerEvent) {
      const ds = dragState.current;
      if (!ds) return;
      if (ds.type === 'node' && ds.nodeId && ds.moved) {
        const dx = e.clientX - ds.startClientX;
        const dy = e.clientY - ds.startClientY;
        onMoveNode(
          ds.nodeId,
          Math.round(ds.origX + dx / zoom),
          Math.round(ds.origY + dy / zoom),
          true
        );
      }
      dragState.current = null;
    }

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, [zoom, onMoveNode]);

  function handleCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.canvasBg) {
      return;
    }
    setMenuNodeId(null);
    onSelectNode(null);
    dragState.current = {
      type: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: pan.x,
      origY: pan.y,
      moved: false,
    };
  }

  function handleNodePointerDown(e: React.PointerEvent, node: WorkflowNode) {
    e.stopPropagation();
    setMenuNodeId(null);
    onSelectNode(node.id);
    if (locked || node.config.lock) return;
    dragState.current = {
      type: 'node',
      nodeId: node.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: node.x,
      origY: node.y,
      moved: false,
    };
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      setZoom((z) => Math.max(0.4, Math.min(1.6, Number((z + delta).toFixed(2)))));
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div
      ref={containerRef}
      onPointerDown={handleCanvasPointerDown}
      onWheel={handleWheel}
      data-canvas-bg="true"
      className="relative flex-1 w-full h-full tekna-canvas-dots overflow-hidden select-none touch-none cursor-grab active:cursor-grabbing"
    >
      {/* Transformed graph layer */}
      <div
        data-canvas-bg="true"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
        className="absolute inset-0 pointer-events-none"
      >
        {/* SVG Edges Layer */}
        <svg
          className="overflow-visible absolute top-0 left-0 pointer-events-none"
          width="3200"
          height="2000"
        >
          <defs>
            <marker
              id="tekna-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#475569" />
            </marker>
            <marker
              id="tekna-arrow-active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#4B4DED" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const src = nodeMap.get(edge.source);
            const tgt = nodeMap.get(edge.target);
            if (!src || !tgt) return null;

            const srcDim = getNodeDimensions(src);
            const tgtDim = getNodeDimensions(tgt);
            const sx = src.x + srcDim.width;
            const sy = src.y + srcDim.height / 2;
            const tx = tgt.x - 4;
            const ty = tgt.y + tgtDim.height / 2;
            const dx = Math.max(40, Math.abs(tx - sx) * 0.45);
            const d = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;

            const midX = (sx + tx) / 2;
            const midY = (sy + ty) / 2;
            const isTargetRunning = nodeRunStates[tgt.id]?.status === 'running';

            return (
              <g key={edge.id} className="pointer-events-auto">
                <path
                  d={d}
                  fill="none"
                  stroke={isTargetRunning ? '#4B4DED' : '#475569'}
                  strokeWidth={isTargetRunning ? 2 : 1.25}
                  markerEnd={isTargetRunning ? 'url(#tekna-arrow-active)' : 'url(#tekna-arrow)'}
                />
                {edge.badgeText !== undefined && (
                  <g
                    transform={`translate(${midX}, ${midY})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteEdge(edge.id);
                    }}
                    className="cursor-pointer group"
                  >
                    <title>Edge branch {edge.badgeText} (click to disconnect)</title>
                    <circle
                      r="10"
                      fill="#8C97A8"
                      className="group-hover:fill-[#DC2626] transition-colors"
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#FFFFFF"
                      fontSize="10.5"
                      fontWeight="600"
                      className="tabular-nums pointer-events-none"
                    >
                      {edge.badgeText}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Nodes Layer */}
        {nodes.map((node) => {
          const isSelected = selectedNodeId === node.id;
          const runState = nodeRunStates[node.id];
          const isRunning = runState?.status === 'running';
          const isCompleted = runState?.status === 'completed';
          const isFailed = runState?.status === 'failed';
          const dim = getNodeDimensions(node);

          // START PILL NODE (exact match to screenshots)
          if (node.kind === 'start') {
            return (
              <div
                key={node.id}
                onPointerDown={(e) => handleNodePointerDown(e, node)}
                style={{ left: node.x, top: node.y, minWidth: dim.width }}
                className={`pointer-events-auto absolute group rounded-full bg-white pl-2 pr-3.5 py-1.5 flex items-center gap-2 cursor-pointer transition-shadow ${
                  isSelected
                    ? 'border-[2px] border-[#312E81] shadow-[0_4px_12px_rgba(49,46,129,0.14)]'
                    : 'border border-[#DCE2EC] shadow-[0_1px_3px_rgba(15,23,42,0.06)] hover:border-[#94A3B8]'
                }`}
              >
                <NodeBadgeIcon kind="start" />
                <div className="flex flex-col leading-tight">
                  <span className="text-[13px] font-medium text-[#0F172A] whitespace-nowrap">
                    {node.title}
                  </span>
                  {triggerType !== 'manual' && (
                    <span className="text-[9.5px] font-medium text-[#4B4DED] uppercase tracking-wider">
                      {triggerType}
                    </span>
                  )}
                </div>

                {/* Output port tick + add button */}
                <button
                  type="button"
                  title="Add connected node"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    onOpenFunctionPicker(node.id, { x: r.right + 14, y: r.top - 120 });
                  }}
                  className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-[#0F172A] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-xs"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            );
          }

          // STANDARD WORKFLOW CARD NODE
          return (
            <div
              key={node.id}
              onPointerDown={(e) => handleNodePointerDown(e, node)}
              style={{ left: node.x, top: node.y, width: dim.width }}
              className={`pointer-events-auto absolute group bg-white rounded-[9px] cursor-pointer transition-shadow ${
                isFailed
                  ? 'border-[2px] border-[#DC2626] shadow-[0_4px_14px_rgba(220,38,38,0.14)]'
                  : isRunning
                    ? 'border-[2px] border-[#4B4DED] shadow-[0_4px_16px_rgba(75,77,237,0.18)]'
                    : isSelected
                      ? 'border-[2px] border-[#312E81] shadow-[0_4px_14px_rgba(49,46,129,0.12)]'
                      : 'border border-[#DCE2EC] shadow-[0_1px_3px_rgba(15,23,42,0.05)] hover:border-[#B6C2D2]'
              }`}
            >
              {/* Left input handle tick */}
              <span className="absolute -left-[5px] top-1/2 -translate-y-1/2 w-[5px] h-[9px] border-l border-t border-b border-[#94A3B8] bg-white rounded-l-[2px]" />

              {/* Card Header */}
              <div className="px-3 py-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <NodeBadgeIcon kind={node.kind} subtype={node.subtype} />
                  <span className="text-[13px] font-semibold text-[#0F172A] truncate">
                    {node.title}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0 text-[#475569]">
                  {isRunning && <Loader2 className="w-3.5 h-3.5 text-[#4B4DED] animate-spin" />}
                  {isCompleted && <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />}
                  {isFailed && <XCircle className="w-3.5 h-3.5 text-[#DC2626]" />}

                  <button
                    type="button"
                    title="Run this node"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRunSingleNode(node.id);
                    }}
                    className="p-0.5 rounded hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-px h-3.5 bg-[#E2E8F0]" />
                  <button
                    type="button"
                    title="Node options"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuNodeId(menuNodeId === node.id ? null : node.id);
                    }}
                    className="p-0.5 rounded hover:bg-[#F1F5F9] hover:text-[#0F172A] transition-colors"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Context Menu */}
              {menuNodeId === node.id && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute right-2 top-9 z-40 w-36 bg-white border border-[#DCE2EC] rounded-lg shadow-lg py-1"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setMenuNodeId(null);
                      onRunSingleNode(node.id);
                    }}
                    className="w-full px-3 py-1.5 text-left text-[12px] text-[#334155] hover:bg-[#F8FAFC] flex items-center gap-2"
                  >
                    <Play className="w-3 h-3" />
                    <span>Run Node</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuNodeId(null);
                      onDeleteNode(node.id);
                    }}
                    className="w-full px-3 py-1.5 text-left text-[12px] text-[#DC2626] hover:bg-[#FEF2F2] flex items-center gap-2"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Delete Node</span>
                  </button>
                </div>
              )}

              {/* Node Kind Specific Sub-rows */}
              {node.kind === 'sql' && (
                <>
                  <div className="border-t border-[#F1F5F9] px-3 py-1.5 text-[12px] text-[#334155] truncate">
                    {node.config.connectionName || 'Northwinds DB'}
                  </div>
                  <div className="border-t border-[#F1F5F9]">
                    <div className="px-3 py-1 text-[11px] font-medium text-[#64748B] border-b border-[#F1F5F9]">
                      Preview
                    </div>
                    <div className="px-2.5 py-2">
                      <SyntaxCodeBlock
                        code={node.config.query || ''}
                        language="sql"
                        maxLines={3}
                        compact
                      />
                    </div>
                  </div>
                </>
              )}

              {node.kind === 'rest' && (
                <>
                  <div className="border-t border-[#F1F5F9] px-3 py-2 flex items-center gap-2">
                    <span className="text-[11.5px] font-bold text-[#0F172A] shrink-0">
                      {node.config.method || 'GET'}
                    </span>
                    <span className="text-[11.5px] text-[#334155] truncate font-mono-code">
                      {node.config.url || 'https://api.example.com'}
                    </span>
                  </div>
                  {node.description && (
                    <div className="mx-2 mb-2 px-2.5 py-2 rounded-[6px] bg-[#FDF2DA] text-[11.5px] leading-[1.35] text-[#785322]">
                      {node.description}
                    </div>
                  )}
                </>
              )}

              {node.kind === 'javascript' && (
                <div className="border-t border-[#F1F5F9]">
                  <div className="px-3 py-1 text-[11px] font-medium text-[#64748B] border-b border-[#F1F5F9]">
                    Preview
                  </div>
                  <div className="px-2.5 py-2">
                    <SyntaxCodeBlock
                      code={node.config.code || ''}
                      language="javascript"
                      maxLines={3}
                      compact
                    />
                  </div>
                </div>
              )}

              {node.kind === 'alert' && (
                <div className="mx-2 mb-2 px-2.5 py-2 rounded-[6px] bg-[#FDF2DA] text-[11.5px] leading-[1.35] text-[#785322]">
                  {node.description || 'Sends an alert if severe weather conditions are detected.'}
                </div>
              )}

              {node.kind === 'ai' && (
                <div className="border-t border-[#F1F5F9] px-3 py-2 text-[11.5px] text-[#475569] truncate">
                  Model: <span className="font-medium text-[#0F172A]">{node.config.model || 'gemini-4-hydrogen'}</span>
                </div>
              )}

              {node.kind === 'condition' && (
                <div className="border-t border-[#F1F5F9] px-3 py-2 text-[11.5px] font-mono-code text-[#475569] truncate">
                  {node.config.expression || 'true'}
                </div>
              )}

              {node.kind === 's3' && (
                <div className="border-t border-[#F1F5F9] px-3 py-1.5 text-[11.5px] text-[#475569] truncate">
                  Prefix: {node.config.s3KeyPrefix || 'wirelogic-exports/'}
                </div>
              )}

              {/* Right port + circular "+" append button (visible on hover or leaf nodes matching Screenshot 2) */}
              <button
                type="button"
                title="Add next node"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  onOpenFunctionPicker(node.id, { x: r.right + 12, y: r.top - 100 });
                }}
                className={`absolute -right-2.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-full bg-[#8C97A8] hover:bg-[#312E81] text-white flex items-center justify-center transition-opacity shadow-xs ${
                  edges.some((ed) => ed.source === node.id)
                    ? 'opacity-0 group-hover:opacity-100'
                    : 'opacity-100'
                }`}
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Bottom-Left Floating Canvas Controls Toolbar (matching Screenshots 1 & 2) */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute left-4 bottom-4 z-20 flex items-center gap-2"
      >
        <div className="bg-white border border-[#DCE2EC] rounded-[8px] shadow-sm flex items-center divide-x divide-[#F1F5F9] overflow-hidden">
          <button
            type="button"
            title="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.1).toFixed(2))))}
            className="w-8 h-8 flex items-center justify-center text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="px-2.5 text-[12px] font-medium text-[#334155] tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            title="Zoom in"
            onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.1).toFixed(2))))}
            className="w-8 h-8 flex items-center justify-center text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Fit workflow to view"
            onClick={handleFitView}
            className="w-8 h-8 flex items-center justify-center text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={locked ? 'Unlock canvas drag' : 'Lock canvas drag'}
            onClick={() => setLocked((l) => !l)}
            className={`w-8 h-8 flex items-center justify-center transition-colors ${
              locked
                ? 'bg-[#EEF2FF] text-[#4B4DED]'
                : 'text-[#475569] hover:bg-[#F8FAFC] hover:text-[#0F172A]'
            }`}
          >
            {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            title="Undo"
            disabled={!canUndo}
            onClick={onUndo}
            className="w-8 h-8 flex items-center justify-center text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-35 transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Redo"
            disabled={!canRedo}
            onClick={onRedo}
            className="w-8 h-8 flex items-center justify-center text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-35 transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          title="Add node"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onOpenFunctionPicker(selectedNodeId, { x: r.left, y: r.top - 380 });
          }}
          className="w-8 h-8 bg-white border border-[#DCE2EC] rounded-[8px] shadow-sm flex items-center justify-center text-[#334155] hover:bg-[#F8FAFC] hover:text-[#0F172A] transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
