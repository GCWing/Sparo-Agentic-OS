/**
 * AgentGroup — collapsible group container for the Agent Board.
 *
 * Shows the group header (icon, label, count, running badge, collapse, new)
 * and renders children in a card grid or row list based on viewMode.
 */

import React, { useCallback } from 'react';
import { ChevronDown, ChevronRight, Plus, Radio } from 'lucide-react';
import { IconButton } from '@/component-library';
import { useI18n } from '@/infrastructure/i18n';
import { type AgentKind, AGENT_KIND_META } from '../taskCenter/agentKinds';
import type { TaskItem, SessionTaskItem } from '../taskCenter/useScopedTasks';
import TaskCard from './TaskCard';
import './AgentGroup.scss';

interface AgentGroupProps {
  kind: AgentKind;
  items: TaskItem[];
  isCollapsed: boolean;
  viewMode: 'cards' | 'rows';
  highlightedId: string | null;
  showWorkspace: boolean;
  onToggleCollapse: (kind: AgentKind) => void;
  onNewSession?: (kind: AgentKind) => void;
  formatRelativeTime: (ts: number) => string;
  onOpen: (item: TaskItem) => void;
  onStop?: (item: TaskItem) => void;
  onDelete?: (item: TaskItem) => void;
  onQuickSend?: (item: SessionTaskItem, message: string) => void;
}

const AgentGroup: React.FC<AgentGroupProps> = ({
  kind,
  items,
  isCollapsed,
  viewMode,
  highlightedId,
  showWorkspace,
  onToggleCollapse,
  onNewSession,
  formatRelativeTime,
  onOpen,
  onStop,
  onDelete,
  onQuickSend,
}) => {
  const { t } = useI18n('common');
  const meta = AGENT_KIND_META[kind];
  const Icon = meta.Icon;
  const runningCount = items.filter((i) => i.status === 'running').length;

  const handleToggle = useCallback(() => {
    onToggleCollapse(kind);
  }, [kind, onToggleCollapse]);

  const handleNew = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onNewSession?.(kind);
    },
    [kind, onNewSession]
  );

  const groupLabel = t(`taskDetailScene.agent.${kind}.label`);

  return (
    <section className="tc-group" aria-label={groupLabel}>
      <div
        className="tc-group__head"
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        onClick={handleToggle}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleToggle()}
      >
        <span className={`tc-group__icon tc-kind-icon--${meta.colorKey}`} aria-hidden>
          <Icon size={14} />
        </span>
        <span className="tc-group__title">{groupLabel}</span>
        <span className="tc-group__count">{items.length}</span>

        {runningCount > 0 && (
          <span className="tc-group__running" aria-label={`${runningCount} running`}>
            <Radio size={9} />
            {runningCount}
          </span>
        )}

        <div className="tc-group__head-spacer" />

        {meta.canCreate && onNewSession && (
          <IconButton
            size="xs"
            variant="ghost"
            tooltip={t(`taskDetailScene.agent.${kind}.newAction`)}
            aria-label={t(`taskDetailScene.agent.${kind}.newAction`)}
            onClick={handleNew}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Plus size={12} />
          </IconButton>
        )}

        <span className="tc-group__collapse-icon" aria-hidden>
          {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </span>
      </div>

      {!isCollapsed && (
        <div className={`tc-group__body tc-group__body--${viewMode}`}>
          {items.length === 0 ? (
            <div className="tc-group__empty">
              <span>{t(`taskDetailScene.agent.${kind}.empty`)}</span>
            </div>
          ) : (
            items.map((item) => (
              <TaskCard
                key={item.id}
                item={item}
                isHighlighted={item.id === highlightedId}
                showWorkspace={showWorkspace}
                viewMode={viewMode}
                formatRelativeTime={formatRelativeTime}
                onOpen={onOpen}
                onStop={onStop}
                onDelete={onDelete}
                onQuickSend={onQuickSend}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
};

export default AgentGroup;
