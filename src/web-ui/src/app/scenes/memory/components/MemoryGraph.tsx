import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Home, Minus, Plus } from 'lucide-react';
import { IconButton } from '@/design-system';
import type { MemoryRecord } from '../MemoryLibraryAPI';
import {
  buildMemoryLayout,
  getTypeColor,
  hexPolygonPoints,
  type MemoryLayout,
  type PositionedNode,
} from '../utils/memoryLayout';

const BACKGROUND_CLICK_MAX_MOVE_PX = 6;

interface MemoryGraphProps {
  records: MemoryRecord[];
  workspaceLabels: Record<string, string>;
  globalLabel: string;
  selectedId: string | null;
  highlightedIds?: Set<string>;
  onSelect: (record: MemoryRecord) => void;
  /** Fired when the user taps empty canvas (not a node) without panning. */
  onClearSelection?: () => void;
  emptyMessage: string;
}

interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;

const MemoryGraph: React.FC<MemoryGraphProps> = ({
  records,
  workspaceLabels,
  globalLabel,
  selectedId,
  highlightedIds,
  onSelect,
  onClearSelection,
  emptyMessage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, tx: 0, ty: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setSize({
        width: Math.max(320, rect.width),
        height: Math.max(320, rect.height),
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout: MemoryLayout = useMemo(
    () => buildMemoryLayout({
      records,
      workspaceLabels,
      globalLabel,
      width: size.width,
      height: size.height,
    }),
    [records, workspaceLabels, globalLabel, size.width, size.height],
  );

  const nodeMap = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const n of layout.nodes) map.set(n.record.id, n);
    return map;
  }, [layout]);

  const focusedRelated = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>([selectedId]);
    for (const edge of layout.edges) {
      if (edge.fromId === selectedId) set.add(edge.toId);
      if (edge.toId === selectedId) set.add(edge.fromId);
    }
    return set;
  }, [selectedId, layout.edges]);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    setViewport((current) => {
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
      // Zoom toward cursor.
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { ...current, scale: nextScale };
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const ratio = nextScale / current.scale;
      const tx = cx - (cx - current.tx) * ratio;
      const ty = cy - (cy - current.ty) * ratio;
      return { scale: nextScale, tx, ty };
    });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-node-id]')) return;
    if (target.closest('.memory-graph__controls')) return;
    if (target.closest('.memory-graph__empty')) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      tx: viewport.tx,
      ty: viewport.ty,
    };
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setViewport((current) => ({
      ...current,
      tx: drag.tx + (event.clientX - drag.startX),
      ty: drag.ty + (event.clientY - drag.startY),
    }));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag && onClearSelection && selectedId) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) < BACKGROUND_CLICK_MAX_MOVE_PX) {
        onClearSelection();
      }
    }
    dragRef.current = null;
    try {
      (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
    } catch {
      /* noop */
    }
  };

  const handleResetView = () => setViewport({ scale: 1, tx: 0, ty: 0 });

  const isFaded = (id: string): boolean => {
    if (focusedRelated && !focusedRelated.has(id)) return true;
    if (highlightedIds && highlightedIds.size > 0 && !highlightedIds.has(id)) return true;
    return false;
  };

  return (
    <div
      ref={containerRef}
      className="memory-graph"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <svg
        className="memory-graph__svg"
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
      >
        <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.scale})`}>
          {/* Group rings (drawn behind nodes) */}
          {layout.groups.map((group) => (
            <g key={group.id} className={`memory-graph__group${group.isCore ? ' is-core' : ''}`}>
              <circle
                cx={group.cx}
                cy={group.cy}
                r={group.ringRadius}
                className="memory-graph__ring"
                style={{ stroke: group.color }}
              />
              {group.isCore ? (
                <circle
                  cx={group.cx}
                  cy={group.cy}
                  r={group.ringRadius * 0.94}
                  className="memory-graph__ring-inner"
                  style={{ stroke: group.color }}
                />
              ) : null}
              <text
                x={group.cx}
                y={group.cy - group.ringRadius - 12}
                className={`memory-graph__group-label${group.isCore ? ' is-core' : ''}`}
                textAnchor="middle"
              >
                {group.label}
              </text>
              <text
                x={group.cx}
                y={group.cy - group.ringRadius - 0}
                className="memory-graph__group-count"
                textAnchor="middle"
              >
                {group.records.length}
              </text>
            </g>
          ))}

          {/* Edges */}
          <g className="memory-graph__edges">
            {layout.edges.map((edge) => {
              const a = nodeMap.get(edge.fromId);
              const b = nodeMap.get(edge.toId);
              if (!a || !b) return null;
              const dim = isFaded(edge.fromId) || isFaded(edge.toId);
              const focused = focusedRelated && (focusedRelated.has(edge.fromId) && focusedRelated.has(edge.toId));
              return (
                <line
                  key={edge.id}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={`memory-graph__edge memory-graph__edge--${edge.kind}${focused ? ' is-focused' : ''}${dim ? ' is-dim' : ''}`}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g className="memory-graph__nodes">
            {layout.nodes.map((node) => {
              const selected = selectedId === node.record.id;
              const hovered = hoveredId === node.record.id;
              const faded = isFaded(node.record.id);
              const color = getTypeColor(node.record.type);
              const r = node.radius;
              const isHex = node.record.isIndex;
              return (
                <g
                  key={node.record.id}
                  data-node-id={node.record.id}
                  className={`memory-graph__node${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}${faded ? ' is-faded' : ''}${node.record.status === 'archived' ? ' is-archived' : ''}`}
                  transform={`translate(${node.x} ${node.y})`}
                  style={{ opacity: node.record.status === 'archived' ? 0.4 : undefined }}
                  onPointerEnter={() => setHoveredId(node.record.id)}
                  onPointerLeave={() => setHoveredId((current) => (current === node.record.id ? null : current))}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(node.record);
                  }}
                >
                  {selected ? (
                    <circle r={r + 5} className="memory-graph__node-halo" style={{ stroke: color }} />
                  ) : null}
                  {isHex ? (
                    <polygon
                      className="memory-graph__node-shape"
                      points={hexPolygonPoints(r + 1.5)}
                      style={{ fill: color }}
                    />
                  ) : (
                    <circle className="memory-graph__node-shape" r={r} style={{ fill: node.record.status === 'archived' ? 'var(--color-text-muted)' : color }} />
                  )}
                  {/* Lock badge for private sensitivity */}
                  {node.record.sensitivity === 'private' ? (
                    <text
                      x={r * 0.55}
                      y={-r * 0.55}
                      fontSize={r * 0.7}
                      className="memory-graph__node-lock"
                      aria-hidden
                    >
                      🔒
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* Hover tooltip */}
      {hoveredId ? (() => {
        const node = nodeMap.get(hoveredId);
        if (!node) return null;
        const screenX = node.x * viewport.scale + viewport.tx;
        const screenY = node.y * viewport.scale + viewport.ty;
        const left = Math.min(Math.max(screenX + 14, 12), size.width - 240);
        const top = Math.min(Math.max(screenY - 8, 12), size.height - 80);
        return (
          <div className="memory-graph__tooltip" style={{ left, top }}>
            <div className="memory-graph__tooltip-title">{node.record.title}</div>
            <div className="memory-graph__tooltip-meta">
              <span
                className="memory-graph__tooltip-dot"
                style={{ background: getTypeColor(node.record.type) }}
              />
              <span>{node.record.type}</span>
              <span className="memory-graph__tooltip-sep">·</span>
              <span className="memory-graph__tooltip-path">{node.record.relativePath}</span>
            </div>
          </div>
        );
      })() : null}

      {layout.nodes.length === 0 ? (
        <div className="memory-graph__empty">{emptyMessage}</div>
      ) : null}

      <div className="memory-graph__controls">
        <IconButton
          type="button"
          size="small"
          variant="ghost"
          onClick={() => setViewport((v) => ({ ...v, scale: Math.min(MAX_SCALE, v.scale * 1.15) }))}
          tooltip="Zoom in"
          aria-label="zoom in"
        >
          <Plus size={14} aria-hidden />
        </IconButton>
        <IconButton
          type="button"
          size="small"
          variant="ghost"
          onClick={() => setViewport((v) => ({ ...v, scale: Math.max(MIN_SCALE, v.scale / 1.15) }))}
          tooltip="Zoom out"
          aria-label="zoom out"
        >
          <Minus size={14} aria-hidden />
        </IconButton>
        <IconButton
          type="button"
          size="small"
          variant="ghost"
          onClick={handleResetView}
          tooltip="Reset view"
          aria-label="reset view"
        >
          <Home size={14} aria-hidden />
        </IconButton>
      </div>
    </div>
  );
};

export default MemoryGraph;
