import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge, Button, SelectableRow } from '@/design-system';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import type { MemoryRecord, MemoryScopeKey } from '../MemoryLibraryAPI';
import { getTypeColor } from '../utils/memoryLayout';

interface ListGroup {
  id: string;
  scope: MemoryScopeKey;
  label: string;
  isCore: boolean;
  records: MemoryRecord[];
}

interface MemoryListProps {
  records: MemoryRecord[];
  workspaceLabels: Record<string, string>;
  globalLabel: string;
  selectedId: string | null;
  onSelect: (record: MemoryRecord) => void;
  emptyMessage: string;
  formatDate: (timestamp?: number) => string;
}

const MemoryList: React.FC<MemoryListProps> = ({
  records,
  workspaceLabels,
  globalLabel,
  selectedId,
  onSelect,
  emptyMessage,
  formatDate,
}) => {
  const itemHover = useMovingHoverHighlight<HTMLDivElement>();
  const groups = useMemo<ListGroup[]>(() => {
    const result: ListGroup[] = [];
    const globals = records.filter((record) => record.scope === 'global' && !record.isWorkspaceOverview);
    if (globals.length > 0) {
      result.push({ id: 'core', scope: 'global', label: globalLabel, isCore: true, records: globals });
    }

    const wsMap = new Map<string, MemoryRecord[]>();
    for (const record of records) {
      if (record.scope !== 'workspace' && !record.isWorkspaceOverview) continue;
      const list = wsMap.get(record.groupKey) ?? [];
      list.push(record);
      wsMap.set(record.groupKey, list);
    }

    for (const [groupKey, list] of wsMap.entries()) {
      const workspaceRecord = list.find((item) => item.scope === 'workspace');
      const overviewRecord = list.find((item) => item.isWorkspaceOverview);
      result.push({
        id: `ws:${groupKey}`,
        scope: 'workspace',
        label: overviewRecord?.workspaceLabel
          ?? (workspaceRecord ? workspaceLabels[workspaceRecord.memoryDir] : undefined)
          ?? list[0]?.workspaceLabel
          ?? list[0]?.title
          ?? 'Workspace',
        isCore: false,
        records: list,
      });
    }

    for (const group of result) {
      group.records = group.records.slice().sort((left, right) => {
        if (left.type === 'memory' && right.type !== 'memory') return -1;
        if (right.type === 'memory' && left.type !== 'memory') return 1;
        if (left.isWorkspaceOverview && !right.isWorkspaceOverview) return -1;
        if (right.isWorkspaceOverview && !left.isWorkspaceOverview) return 1;
        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
      });
    }

    return result;
  }, [records, workspaceLabels, globalLabel]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (groups.length === 0) {
    return <div className="memory-list__empty">{emptyMessage}</div>;
  }

  const toggle = (id: string) => {
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  };

  return (
    <div
      ref={itemHover.surfaceRef}
      className="memory-list memory-list--motion"
      {...itemHover.getSurfaceHandlers('.memory-list__item-main')}
    >
      <div
        className="memory-list__hover-highlight"
        style={{
          transform: `translate3d(${itemHover.highlight.left}px, ${itemHover.highlight.top}px, 0) scale(${itemHover.highlight.stretchX}, ${itemHover.highlight.stretchY})`,
          width: `${itemHover.highlight.width}px`,
          height: `${itemHover.highlight.height}px`,
          opacity: itemHover.highlight.visible ? 1 : 0,
        }}
        aria-hidden
      />
      {groups.map((group) => {
        const isCollapsed = Boolean(collapsed[group.id]);
        return (
          <section
            key={group.id}
            className={`memory-list__group${group.isCore ? ' is-core' : ''}${isCollapsed ? ' is-collapsed' : ''}`}
          >
            <Button
              size="small"
              variant="ghost"
              className="memory-list__group-header"
              onClick={() => toggle(group.id)}
              aria-expanded={!isCollapsed}
            >
              <span className={`memory-list__group-icon${group.isCore ? ' is-core' : ''}`} aria-hidden>
                <span className="memory-list__group-icon-ring" />
              </span>
              <span className="memory-list__group-label">{group.label}</span>
              <span className="memory-list__group-count">{group.records.length}</span>
              <span className="memory-list__group-chevron" aria-hidden>
                <ChevronDown size={14} />
              </span>
            </Button>
            {isCollapsed ? null : (
              <div className="memory-list__items">
                {group.records.map((record) => (
                  <div
                    key={record.id}
                    className={`memory-list__item${selectedId === record.id ? ' is-selected' : ''}${record.status === 'archived' ? ' is-archived' : ''}`}
                    style={{ '--item-dot-color': getTypeColor(record.type) } as React.CSSProperties}
                  >
                    <SelectableRow
                      className="memory-list__item-main"
                      onClick={() => onSelect(record)}
                      selected={selectedId === record.id}
                      leading={<span className="memory-list__item-icon" aria-hidden />}
                      title={record.title}
                      meta={(
                        <span className="memory-list__item-title-row">
                          {record.status && record.status !== 'confirmed' ? (
                            <Badge className="memory-list__badge" variant="neutral">
                              {record.status}
                            </Badge>
                          ) : null}
                          {record.updatedAt ? (
                            <span className="memory-list__item-time">{formatDate(record.updatedAt)}</span>
                          ) : null}
                        </span>
                      )}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
};

export default MemoryList;
