import React, { useMemo, useState } from 'react';
import { Check, MessageSquare, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { Button, IconButton, Input, Select, type SelectOption } from '@/design-system';
import type { MarkdownAction, MarkdownIntent, MarkdownScope } from './protocol';
import type { SuggestionEntry } from './suggestionStore';
import type { MarkdownDiffReview } from './documentDiff';

interface CoauthorControlsProps {
  actions: MarkdownAction[];
  scope: MarkdownScope;
  intent: MarkdownIntent;
  activeEntry?: SuggestionEntry;
  documentDiff?: MarkdownDiffReview | null;
  handledHunkIds?: Set<string>;
  disabled?: boolean;
  busy?: boolean;
  labels: {
    barLabel: string;
    actionPlaceholder: string;
    promptPlaceholder: string;
    apply: string;
    review: string;
    run: string;
    acceptAll: string;
    rejectAll: string;
    stale: string;
    comments: string;
    profileOn: string;
    profileOff: string;
    retry: string;
    acceptOp: string;
    rejectOp: string;
    acceptHunk: string;
    rejectHunk: string;
  };
  onScopeChange: (scope: MarkdownScope) => void;
  onIntentChange: (intent: MarkdownIntent) => void;
  onRun: (actionId: string, directive: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onAcceptOp: (opId: string) => void;
  onRejectOp: (opId: string) => void;
  onAcceptHunk: (hunkId: string) => void;
  onRejectHunk: (hunkId: string) => void;
  onRetry: () => void;
  onToggleProfile: () => void;
  profileEnabled: boolean;
}

const scopeOptions: SelectOption[] = [
  { label: 'Selection', value: 'selection' },
  { label: 'Block', value: 'block' },
  { label: 'Document', value: 'document' },
];

export const CoauthorControls: React.FC<CoauthorControlsProps> = ({
  actions,
  scope,
  intent,
  activeEntry,
  documentDiff,
  handledHunkIds,
  disabled,
  busy,
  labels,
  onScopeChange,
  onIntentChange,
  onRun,
  onAcceptAll,
  onRejectAll,
  onAcceptOp,
  onRejectOp,
  onAcceptHunk,
  onRejectHunk,
  onRetry,
  onToggleProfile,
  profileEnabled,
}) => {
  const [actionId, setActionId] = useState(actions[0]?.id ?? '');
  const [directive, setDirective] = useState('');

  const actionOptions = useMemo<SelectOption[]>(() => actions.map(action => ({
    label: action.title,
    value: action.id,
    group: action.group,
  })), [actions]);

  const currentAction = actions.find(action => action.id === actionId) ?? actions[0];
  const canRun = !!currentAction && !disabled && !busy;
  const commentCount = activeEntry?.proposal.ops.filter(op => op.type === 'comment').length ?? 0;
  const handledOpIds = useMemo(() => new Set([
    ...(activeEntry?.acceptedOpIds ?? []),
    ...(activeEntry?.rejectedOpIds ?? []),
  ]), [activeEntry?.acceptedOpIds, activeEntry?.rejectedOpIds]);

  return (
    <div className="m-editor-coauthor" data-testid="md-coauthor-bar">
      <div className="m-editor-coauthor__leading">
        <Sparkles size={15} strokeWidth={1.9} />
        <span>{labels.barLabel}</span>
      </div>
      <Select
        size="small"
        value={scope}
        options={scopeOptions}
        disabled={busy}
        onChange={(value) => onScopeChange(value as MarkdownScope)}
      />
      <div className="m-editor-coauthor__intent" role="group" aria-label={labels.barLabel}>
        <Button
          type="button"
          size="small"
          variant={intent === 'apply' ? 'primary' : 'ghost'}
          onClick={() => onIntentChange('apply')}
          disabled={busy}
        >
          {labels.apply}
        </Button>
        <Button
          type="button"
          size="small"
          variant={intent === 'review' ? 'primary' : 'ghost'}
          onClick={() => onIntentChange('review')}
          disabled={busy}
        >
          {labels.review}
        </Button>
      </div>
      <Select
        className="m-editor-coauthor__action"
        size="small"
        value={currentAction?.id}
        placeholder={labels.actionPlaceholder}
        options={actionOptions}
        disabled={busy || actions.length === 0}
        onChange={(value) => setActionId(String(value))}
      />
      <Input
        className="m-editor-coauthor__directive"
        inputSize="small"
        variant="filled"
        value={directive}
        placeholder={labels.promptPlaceholder}
        disabled={busy}
        onChange={(event) => setDirective(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canRun) {
            onRun(currentAction.id, directive);
          }
        }}
      />
      <IconButton
        type="button"
        size="small"
        variant="brand"
        aria-label={labels.run}
        tooltip={labels.run}
        disabled={!canRun}
        onClick={() => {
          if (currentAction) {
            onRun(currentAction.id, directive);
          }
        }}
      >
        <Sparkles size={14} />
      </IconButton>
      <IconButton
        type="button"
        size="small"
        aria-label={profileEnabled ? labels.profileOn : labels.profileOff}
        tooltip={profileEnabled ? labels.profileOn : labels.profileOff}
        onClick={onToggleProfile}
        disabled={busy}
      >
        <MessageSquare size={14} />
      </IconButton>
      {activeEntry && (
        <>
          <div className="m-editor-coauthor__review" data-status={activeEntry.status}>
            {activeEntry.status === 'stale' && <span className="m-editor-coauthor__stale">{labels.stale}</span>}
            {commentCount > 0 && <span className="m-editor-coauthor__comments">{labels.comments}: {commentCount}</span>}
            <IconButton type="button" size="small" aria-label={labels.acceptAll} tooltip={labels.acceptAll} onClick={onAcceptAll}>
              <Check size={14} />
            </IconButton>
            <IconButton type="button" size="small" aria-label={labels.rejectAll} tooltip={labels.rejectAll} onClick={onRejectAll}>
              <X size={14} />
            </IconButton>
            <IconButton type="button" size="small" aria-label={labels.retry} tooltip={labels.retry} onClick={onRetry}>
              <RotateCcw size={14} />
            </IconButton>
            <IconButton type="button" size="small" variant="danger" aria-label={labels.rejectAll} tooltip={labels.rejectAll} onClick={onRejectAll}>
              <Trash2 size={14} />
            </IconButton>
          </div>
          <div className="m-editor-coauthor__proposal" data-testid="md-coauthor-review">
            <div className="m-editor-coauthor__proposal-title">
              {activeEntry.proposal.summary || activeEntry.proposal.ops[0]?.type}
            </div>
            {documentDiff ? (
              <div className="m-editor-coauthor__diff" data-testid="md-coauthor-document-diff">
                <div className="m-editor-coauthor__diff-stats">
                  +{documentDiff.diff.stats.additions} / -{documentDiff.diff.stats.deletions}
                </div>
                <div className="m-editor-coauthor__diff-hunks">
                  {documentDiff.diff.hunks.filter(hunk => !handledHunkIds?.has(hunk.id)).map((hunk) => (
                    <div key={hunk.id} className="m-editor-coauthor__diff-hunk">
                      <div className="m-editor-coauthor__diff-hunk-header">
                        <span>
                          {hunk.originalStartLine}-{hunk.originalEndLine}
                        </span>
                        <span className="m-editor-coauthor__diff-hunk-actions">
                          <IconButton
                            type="button"
                            size="xs"
                            aria-label={labels.acceptHunk}
                            tooltip={labels.acceptHunk}
                            onClick={() => onAcceptHunk(hunk.id)}
                          >
                            <Check size={12} />
                          </IconButton>
                          <IconButton
                            type="button"
                            size="xs"
                            aria-label={labels.rejectHunk}
                            tooltip={labels.rejectHunk}
                            onClick={() => onRejectHunk(hunk.id)}
                          >
                            <X size={12} />
                          </IconButton>
                        </span>
                      </div>
                      <div className="m-editor-coauthor__diff-lines">
                        {[
                          ...hunk.originalContent.map(content => ({ type: 'removed' as const, content })),
                          ...hunk.modifiedContent.map(content => ({ type: 'added' as const, content })),
                        ].map((line, index) => (
                          <div
                            key={`${hunk.id}-${line.type}-${index}`}
                            className="m-editor-coauthor__diff-line"
                            data-line-type={line.type}
                          >
                            <span className="m-editor-coauthor__diff-gutter">
                              {line.type === 'added' ? '+' : '-'}
                            </span>
                            <code>{line.content || ' '}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="m-editor-coauthor__ops">
                {activeEntry.proposal.ops.map(op => (
                <div key={op.id} className="m-editor-coauthor__op" data-op-type={op.type} data-handled={handledOpIds.has(op.id) ? 'true' : 'false'}>
                  <span className="m-editor-coauthor__op-type">{op.type}</span>
                  {'markdown' in op && <pre className="m-editor-coauthor__op-markdown">{op.markdown}</pre>}
                  {'message' in op && <p className="m-editor-coauthor__op-message">{op.message}</p>}
                  {'reason' in op && op.reason && <p className="m-editor-coauthor__op-reason">{op.reason}</p>}
                  <div className="m-editor-coauthor__op-actions">
                    <IconButton
                      type="button"
                      size="xs"
                      aria-label={labels.acceptOp}
                      tooltip={labels.acceptOp}
                      disabled={handledOpIds.has(op.id)}
                      onClick={() => onAcceptOp(op.id)}
                    >
                      <Check size={12} />
                    </IconButton>
                    <IconButton
                      type="button"
                      size="xs"
                      aria-label={labels.rejectOp}
                      tooltip={labels.rejectOp}
                      disabled={handledOpIds.has(op.id)}
                      onClick={() => onRejectOp(op.id)}
                    >
                      <X size={12} />
                    </IconButton>
                  </div>
                </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
