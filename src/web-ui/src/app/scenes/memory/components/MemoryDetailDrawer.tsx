import React, { useEffect, useMemo, useState } from 'react';
import { Archive, ChevronDown, FolderOpen, Lock, Pencil, Save, Trash2, X } from 'lucide-react';
import { Button, IconButton, Textarea, Tooltip } from '@/design-system';
import { Markdown } from '@/shared/markdown';
import type { MemoryRecord } from '../MemoryLibraryAPI';
import { getRelatedRecords, getTypeColor } from '../utils/memoryLayout';

interface MemoryDetailDrawerProps {
  record: MemoryRecord | null;
  allRecords: MemoryRecord[];
  workspaceLabels: Record<string, string>;
  isOpen: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSave: (record: MemoryRecord, content: string) => Promise<void>;
  onReveal: (record: MemoryRecord) => void;
  onDelete: (record: MemoryRecord) => void;
  onArchive: (record: MemoryRecord) => void;
  onSelectRelated: (record: MemoryRecord) => void;
  formatDate: (timestamp?: number) => string;
  typeLabel: (type: MemoryRecord['type']) => string;
  scopeLabel: (scope: MemoryRecord['scope']) => string;
  reasonLabel: (reason: 'index' | 'same-folder' | 'cross-scope') => string;
  usageHint: (type: MemoryRecord['type']) => string;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

const MemoryDetailDrawer: React.FC<MemoryDetailDrawerProps> = ({
  record,
  allRecords,
  workspaceLabels,
  isOpen,
  isSaving,
  onClose,
  onSave,
  onReveal,
  onDelete,
  onArchive,
  onSelectRelated,
  formatDate,
  typeLabel,
  scopeLabel,
  reasonLabel,
  usageHint,
  t,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [relationsOpen, setRelationsOpen] = useState(false);

  const recordId = record?.id;
  const recordContent = record?.content;
  useEffect(() => {
    if (!recordId) return;
    setIsEditing(false);
    setDraft(recordContent ?? '');
    setRelationsOpen(false);
  }, [recordId, recordContent]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const related = useMemo(() => {
    if (!record) return [];
    const workspaceLabel = record.scope === 'workspace'
      ? workspaceLabels[record.memoryDir]
      : Object.values(workspaceLabels)[0];
    return getRelatedRecords(record, allRecords, workspaceLabel);
  }, [record, allRecords, workspaceLabels]);

  if (!record) {
    return (
      <aside className={`memory-drawer${isOpen ? ' is-open' : ''}`} aria-hidden={!isOpen}>
        <div className="memory-drawer__empty">{t('empty.noSelection')}</div>
      </aside>
    );
  }

  const canDelete = !record.isIndex;
  const color = getTypeColor(record.type);

  const handleSaveClick = async () => {
    await onSave(record, draft);
    setIsEditing(false);
  };

  return (
    <aside className={`memory-drawer${isOpen ? ' is-open' : ''}`} aria-hidden={!isOpen}>
      <header className="memory-drawer__header">
        <div className="memory-drawer__header-row">
          <div className="memory-drawer__header-tags">
            <Tooltip content={usageHint(record.type)} placement="bottom">
              <span className="memory-drawer__type-chip" style={{ borderColor: color, color }}>
                <span className="memory-drawer__type-dot" style={{ background: color }} />
                {typeLabel(record.type)}
              </span>
            </Tooltip>
            <span className="memory-drawer__scope">{scopeLabel(record.scope)}</span>
            {record.updatedAt ? (
              <span className="memory-drawer__updated">{formatDate(record.updatedAt)}</span>
            ) : null}
          </div>
          <IconButton
            size="xs"
            variant="ghost"
            onClick={onClose}
            aria-label={t('actions.cancel')}
            tooltip={t('actions.cancel')}
            tooltipPlacement="bottom"
          >
            <X size={15} />
          </IconButton>
        </div>

        <div className="memory-drawer__title-row">
          <h3 className="memory-drawer__title">{record.title}</h3>
          <div className="memory-drawer__title-actions">
            {isEditing ? (
              <>
                <Tooltip content={t('actions.save')} placement="bottom">
                  <IconButton
                    size="small"
                    variant="primary"
                    onClick={() => void handleSaveClick()}
                    disabled={isSaving}
                    aria-label={t('actions.save')}
                  >
                    <Save size={15} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t('actions.cancel')} placement="bottom">
                  <IconButton
                    size="small"
                    variant="ghost"
                    onClick={() => {
                      setIsEditing(false);
                      setDraft(record.content ?? '');
                    }}
                    disabled={isSaving}
                    aria-label={t('actions.cancel')}
                  >
                    <X size={15} />
                  </IconButton>
                </Tooltip>
              </>
            ) : (
              <>
                <Tooltip content={t('actions.edit')} placement="bottom">
                  <IconButton
                    size="small"
                    variant="ghost"
                    onClick={() => setIsEditing(true)}
                    aria-label={t('actions.edit')}
                  >
                    <Pencil size={15} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t('actions.reveal')} placement="bottom">
                  <IconButton
                    size="small"
                    variant="ghost"
                    onClick={() => onReveal(record)}
                    aria-label={t('actions.reveal')}
                  >
                    <FolderOpen size={15} />
                  </IconButton>
                </Tooltip>
                {record.status !== 'archived' ? (
                  <Tooltip content={t('actions.archive')} placement="bottom">
                    <IconButton
                      size="small"
                      variant="ghost"
                      disabled={!canDelete}
                      onClick={() => canDelete && onArchive(record)}
                      aria-label={t('actions.archive')}
                    >
                      <Archive size={15} />
                    </IconButton>
                  </Tooltip>
                ) : null}
                <Tooltip content={t('actions.forget')} placement="bottom">
                  <IconButton
                    size="small"
                    variant="danger"
                    disabled={!canDelete}
                    onClick={() => canDelete && onDelete(record)}
                    aria-label={t('actions.forget')}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </div>
        </div>

        <div className="memory-drawer__path" title={record.path}>{record.relativePath}</div>

        {/* Metadata row: layer / status / sensitivity / tags */}
        <div className="memory-drawer__meta-row">
          {record.layer ? (
            <span className="memory-drawer__meta-chip memory-drawer__meta-chip--layer">
              {record.layer}
            </span>
          ) : null}
          {record.status ? (
            <span className={`memory-drawer__meta-chip memory-drawer__meta-chip--status memory-drawer__meta-chip--status-${record.status}`}>
              {t(`statuses.${record.status}`)}
            </span>
          ) : null}
          {record.sensitivity && record.sensitivity !== 'normal' ? (
            <span className="memory-drawer__meta-chip memory-drawer__meta-chip--sensitivity">
              <Lock size={10} />
              {t(`sensitivity.${record.sensitivity}`)}
            </span>
          ) : null}
          {record.tags?.map((tag) => (
            <span key={tag} className="memory-drawer__meta-chip memory-drawer__meta-chip--tag">
              #{tag}
            </span>
          ))}
        </div>
        {record.sourceSession ? (
          <div className="memory-drawer__source-session">
            {t('drawer.sourceSession')}: <code>{record.sourceSession}</code>
          </div>
        ) : null}
      </header>

      <div className="memory-drawer__body">
        {isEditing ? (
          <Textarea
            className="memory-drawer__editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            autoFocus
            variant="filled"
          />
        ) : (
          <div className="memory-drawer__markdown">
            <Markdown content={record.content || t('empty.emptyFile')} />
          </div>
        )}

        {!isEditing && related.length > 0 ? (
          <section
            className={`memory-drawer__relations-section${relationsOpen ? ' is-open' : ''}`}
          >
            <Button
              className="memory-drawer__relations-toggle"
              size="small"
              variant="ghost"
              onClick={() => setRelationsOpen((current) => !current)}
              aria-expanded={relationsOpen}
            >
              <span>{t('drawer.tabs.relations')}</span>
              <span className="memory-drawer__relations-count">{related.length}</span>
              <span className="memory-drawer__relations-chevron" aria-hidden>
                <ChevronDown size={14} />
              </span>
            </Button>
            {relationsOpen ? (
              <ul className="memory-drawer__relations">
                {related.map(({ record: rel, reason }) => (
                  <li key={rel.id}>
                    <Button
                      className="memory-drawer__relation-item"
                      size="small"
                      variant="ghost"
                      onClick={() => onSelectRelated(rel)}
                    >
                      <span
                        className="memory-drawer__relation-dot"
                        style={{ background: getTypeColor(rel.type) }}
                      />
                      <span className="memory-drawer__relation-body">
                        <span className="memory-drawer__relation-title">{rel.title}</span>
                        <span className="memory-drawer__relation-meta">
                          {reasonLabel(reason)} · {rel.relativePath}
                        </span>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
      </div>
    </aside>
  );
};

export default MemoryDetailDrawer;
