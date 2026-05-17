import React, { useMemo, useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { Badge, Button, IconButton, SelectableRow } from '@/design-system';
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
  onDelete: (record: MemoryRecord) => void;
  emptyMessage: string;
  formatDate: (timestamp?: number) => string;
}

const MemoryList: React.FC<MemoryListProps> = ({
  records,
  workspaceLabels,
  globalLabel,
  selectedId,
  onSelect,
  onDelete,
  emptyMessage,
  formatDate,
}) => {
  const groups = useMemo<ListGroup[]>(() => {
    const result: ListGroup[] = [];
    const globals = records.filter((r) => r.scope === 'global');
    if (globals.length > 0) {
      result.push({ id: 'core', scope: 'global', label: globalLabel, isCore: true, records: globals });
    }
    const wsMap = new Map<string, MemoryRecord[]>();
    for (const r of records) {
      if (r.scope !== 'workspace') continue;
      const arr = wsMap.get(r.memoryDir) ?? [];
      arr.push(r);
      wsMap.set(r.memoryDir, arr);
    }
    for (const [memoryDir, list] of wsMap.entries()) {
      result.push({
        id: `ws:${memoryDir}`,
        scope: 'workspace',
        label: workspaceLabels[memoryDir] ?? list[0]?.title ?? 'Workspace',
        isCore: false,
        records: list,
      });
    }
    for (const group of result) {
      group.records = group.records.slice().sort((a, b) => {
        if (a.isIndex && !b.isIndex) return -1;
        if (b.isIndex && !a.isIndex) return 1;
        if (a.isWorkspaceOverview && !b.isWorkspaceOverview) return -1;
        if (b.isWorkspaceOverview && !a.isWorkspaceOverview) return 1;
        return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
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
    <div className="memory-list">
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
                <IconButton
                  className="memory-list__item-delete"
                  size="xs"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); onDelete(record); }}
                  aria-label="Delete"
                  tooltip="Delete"
                >
                  <Trash2 size={12} />
                </IconButton>
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
