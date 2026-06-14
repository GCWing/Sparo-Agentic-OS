import type React from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { ContextDropZone } from '../../../shared/context-system';
import type { ContextItem } from '../../../shared/types/context';
import type { ContextBudgetSnapshot, ContextBudgetSegment, ContextSegmentKind } from '../../types/flow-chat';
import { SmartRecommendations } from '../smart-recommendations';

interface RecommendationContext {
  workspacePath?: string;
  sessionId?: string;
  turnIndex?: number;
  modifiedFiles?: string[];
}

interface ComposerShellProps {
  containerRef: React.Ref<HTMLDivElement>;
  className?: string;
  isActive: boolean;
  isExpanded: boolean;
  isAwakening: boolean;
  isStacked: boolean;
  isTargeting: boolean;
  isProcessing: boolean;
  recommendationContext: RecommendationContext | null;
  sessionActivity?: React.ReactNode;
  targetSwitcher: React.ReactNode;
  editorArea: React.ReactNode;
  actions: React.ReactNode;
  workspaceMeta: string;
  contextUsageMeta: string;
  contextUsagePercent: number;
  contextBudgetSnapshot?: ContextBudgetSnapshot;
  onActivate?: (event: React.MouseEvent) => void;
  onOpenWorkspaceFiles?: () => void;
  onContextAdded: (context: ContextItem) => void;
}

const CONTEXT_KIND_META: Record<ContextSegmentKind, { labelKey: string; color: string; order: number }> = {
  system_prompt: { labelKey: 'systemPrompt', color: 'var(--ds-chat-text-muted)', order: 1 },
  environment: { labelKey: 'environment', color: 'var(--ds-status-surface-warning-fg)', order: 2 },
  workspace_instructions: { labelKey: 'workspace', color: 'var(--ds-status-surface-warning-fg)', order: 3 },
  memory: { labelKey: 'memory', color: 'var(--ds-status-surface-info-fg)', order: 4 },
  files_context: { labelKey: 'files', color: 'var(--ds-status-surface-info-fg)', order: 5 },
  tool_schemas: { labelKey: 'toolDefinitions', color: 'var(--ds-status-surface-success-fg)', order: 6 },
  skill_catalog: { labelKey: 'skills', color: 'var(--ds-chat-accent, var(--ds-status-surface-info-fg))', order: 7 },
  subagent_catalog: { labelKey: 'subagentDefinitions', color: 'var(--ds-tool-family-agent-app-fg, var(--ds-chat-text-secondary))', order: 8 },
  conversation_history: { labelKey: 'conversation', color: 'var(--ds-chat-danger, var(--ds-status-surface-danger-fg))', order: 9 },
  current_user_message: { labelKey: 'currentMessage', color: 'var(--ds-chat-accent)', order: 10 },
  assistant_history: { labelKey: 'assistant', color: 'var(--ds-chat-text-muted)', order: 11 },
  tool_results: { labelKey: 'toolResults', color: 'var(--ds-status-surface-success-fg)', order: 12 },
  images: { labelKey: 'images', color: 'var(--ds-status-surface-info-fg)', order: 13 },
  compression_summary: { labelKey: 'summary', color: 'var(--ds-status-surface-warning-fg)', order: 14 },
  provider_overhead: { labelKey: 'overhead', color: 'var(--ds-chat-text-muted)', order: 15 },
};

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(tokens >= 10000 ? 0 : 1)}k`;
  return `${tokens}`;
}

function formatPercent(percent: number): string {
  if (percent <= 0) return '0%';
  if (percent < 0.1) return '<0.1%';
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${percent.toFixed(0)}%`;
}

function aggregateSegments(segments: ContextBudgetSegment[]): ContextBudgetSegment[] {
  const grouped = new Map<ContextSegmentKind, ContextBudgetSegment>();
  for (const segment of segments) {
    const existing = grouped.get(segment.kind);
    if (existing) {
      existing.tokens += segment.tokens;
      existing.percent += segment.percent;
    } else {
      grouped.set(segment.kind, { ...segment, children: [] });
    }
  }
  return Array.from(grouped.values()).sort((a, b) => {
    const aMeta = CONTEXT_KIND_META[a.kind]?.order ?? 99;
    const bMeta = CONTEXT_KIND_META[b.kind]?.order ?? 99;
    return aMeta - bMeta;
  });
}

export function ComposerShell({
  containerRef,
  className = '',
  isActive,
  isExpanded,
  isAwakening,
  isStacked,
  isTargeting,
  isProcessing,
  recommendationContext,
  sessionActivity,
  targetSwitcher,
  editorArea,
  actions,
  workspaceMeta,
  contextUsageMeta,
  contextUsagePercent,
  contextBudgetSnapshot,
  onActivate,
  onOpenWorkspaceFiles,
  onContextAdded,
}: ComposerShellProps) {
  const { t } = useTranslation('flow-chat');
  const [isContextDetailsOpen, setIsContextDetailsOpen] = useState(false);
  const [hoveredContextKind, setHoveredContextKind] = useState<ContextSegmentKind | null>(null);
  const contextRingStyle = {
    '--sparo-chat-input-context-percent': `${contextUsagePercent}%`,
  } as React.CSSProperties;
  const contextSegments = useMemo(
    () => aggregateSegments(contextBudgetSnapshot?.segments || []),
    [contextBudgetSnapshot?.segments]
  );

  return (
    <ContextDropZone
      acceptedTypes={['file', 'directory', 'image', 'code-snippet']}
      className="sparo-chat-input-drop-zone"
      onContextAdded={onContextAdded}
    >
      <div
        ref={containerRef}
        className={`sparo-chat-input ${isActive ? 'sparo-chat-input--active' : 'sparo-chat-input--collapsed'} ${isExpanded ? 'sparo-chat-input--expanded' : ''} ${isAwakening ? 'sparo-chat-input--awakening' : ''} ${isStacked ? 'sparo-chat-input--multiline' : ''} ${isTargeting ? 'sparo-chat-input--targeting' : ''} ${isProcessing ? 'sparo-chat-input--processing' : ''} ${className}`}
        onClick={!isActive ? onActivate : undefined}
        data-testid="chat-input-container"
      >
        {recommendationContext && (
          <SmartRecommendations
            context={recommendationContext}
            className="sparo-chat-input__recommendations"
          />
        )}

        <div className="sparo-chat-input__container">
          {isContextDetailsOpen && (
            <div
              className={`sparo-chat-input__context-popover ${hoveredContextKind ? 'sparo-chat-input__context-popover--highlighting' : ''}`}
              onMouseLeave={() => setHoveredContextKind(null)}
            >
              {contextBudgetSnapshot ? (
                <>
                  <div className="sparo-chat-input__context-popover-head">
                    <span>
                      {contextBudgetSnapshot.kind === 'static'
                        ? t('contextBudget.staticContext')
                        : t('contextBudget.currentRequest')}
                    </span>
                    <span>
                      {formatTokens(contextBudgetSnapshot.totals.inputTokens)} / {formatTokens(contextBudgetSnapshot.contextWindow)}
                    </span>
                    <button
                      type="button"
                      className="sparo-chat-input__context-close"
                      onClick={() => setIsContextDetailsOpen(false)}
                      aria-label={t('contextBudget.closeDetails')}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </div>
                  {contextSegments.length > 0 ? (
                    <>
                      <div className="sparo-chat-input__context-progress" aria-hidden="true">
                        {contextSegments.map(segment => {
                          const meta = CONTEXT_KIND_META[segment.kind];
                          const width = Math.max(0, Math.min(100, segment.percent));
                          const isHovered = hoveredContextKind === segment.kind;
                          return (
                            <span
                              key={segment.kind}
                              className={`sparo-chat-input__context-progress-part ${isHovered ? 'sparo-chat-input__context-progress-part--active' : ''}`}
                              style={{
                                width: `${width}%`,
                                flexBasis: `${width}%`,
                                background: meta?.color,
                              }}
                              onMouseEnter={() => setHoveredContextKind(segment.kind)}
                            />
                          );
                        })}
                      </div>
                      <div className="sparo-chat-input__context-list">
                        {contextSegments.map(segment => {
                          const meta = CONTEXT_KIND_META[segment.kind];
                          const isHovered = hoveredContextKind === segment.kind;
                          return (
                            <div
                              key={segment.kind}
                              className={`sparo-chat-input__context-row ${isHovered ? 'sparo-chat-input__context-row--active' : ''}`}
                              onMouseEnter={() => setHoveredContextKind(segment.kind)}
                            >
                              <span className="sparo-chat-input__context-swatch" style={{ background: meta?.color }} />
                              <span className="sparo-chat-input__context-label">
                                {meta ? t(`contextBudget.segments.${meta.labelKey}`) : segment.label}
                              </span>
                              <span className="sparo-chat-input__context-value">
                                {formatTokens(segment.tokens)} / {formatPercent(segment.percent)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="sparo-chat-input__context-empty">{t('contextBudget.noSegmentData')}</div>
                  )}
                </>
              ) : (
                <div className="sparo-chat-input__context-empty">
                  <span>{t('contextBudget.calculating')}</span>
                  <button
                    type="button"
                    className="sparo-chat-input__context-close"
                    onClick={() => setIsContextDetailsOpen(false)}
                    aria-label={t('contextBudget.closeDetails')}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          )}
          {sessionActivity && (
            <div className="sparo-chat-input__session-activity">
              {sessionActivity}
            </div>
          )}
          <div className={`sparo-chat-input__box ${isExpanded ? 'sparo-chat-input__box--expanded' : ''}`}>
            {targetSwitcher}
            {editorArea}
            {actions}
          </div>
          <div className="sparo-chat-input__meta" onClick={event => event.stopPropagation()}>
            <button
              type="button"
              className="sparo-chat-input__meta-workspace"
              title={workspaceMeta}
              onClick={onOpenWorkspaceFiles}
            >
              {workspaceMeta}
            </button>
            <button
              type="button"
              className="sparo-chat-input__meta-context"
              onClick={() => setIsContextDetailsOpen(open => !open)}
              aria-expanded={isContextDetailsOpen}
            >
              <span
                className="sparo-chat-input__context-ring"
                style={contextRingStyle}
                aria-hidden="true"
              />
              {contextUsageMeta}
            </button>
          </div>
        </div>
      </div>
    </ContextDropZone>
  );
}
