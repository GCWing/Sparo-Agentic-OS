/**
 * Compact floating save bar.
 *
 * Stays bottom-centred above the workspace. Surfaces a single summary line and
 * two actions (discard / save). Clicking the summary line jumps to the first
 * dirty Section so users can review the change before saving.
 */
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { DotMatrixLoader } from '@/design-system';

export interface DirtyEntry {
  id: string;
  agentId: string;
  agentName: string;
  kind: 'tools' | 'skills' | 'subagents';
  count: number;
}

export interface DirtyBarProps {
  entries: DirtyEntry[];
  saving: boolean;
  onSave: () => void | Promise<void>;
  onDiscard: () => void;
  onJump?: (entry: DirtyEntry) => void;
}

export function DirtyBar({ entries, saving, onSave, onDiscard, onJump }: DirtyBarProps) {
  const { t } = useTranslation('scenes/apps');
  if (entries.length === 0) return null;

  const uniqueAgents = new Set(entries.map((e) => e.agentId));
  const primaryEntry = entries[0]!;
  const summary =
    uniqueAgents.size === 1
      ? t('appDetail.dirtyBar.summaryInAgent', {
          count: entries.length,
          agent: primaryEntry.agentName,
        })
      : t('appDetail.dirtyBar.summaryAcrossAgents', {
          count: entries.length,
          agents: uniqueAgents.size,
        });

  return (
    <div className="app-detail-dirty-bar" role="status" aria-live="polite">
      <button
        type="button"
        className="app-detail-dirty-bar__summary"
        onClick={() => onJump?.(primaryEntry)}
        title={t('appDetail.dirtyBar.jumpHint')}
      >
        <span className="app-detail-dirty-bar__pulse" aria-hidden="true" />
        <span className="app-detail-dirty-bar__text">{summary}</span>
      </button>
      <div className="app-detail-dirty-bar__divider" aria-hidden="true" />
      <div className="app-detail-dirty-bar__actions">
        <button
          type="button"
          className="app-detail-dirty-bar__action app-detail-dirty-bar__action--ghost"
          onClick={onDiscard}
          disabled={saving}
          aria-label={t('appDetail.dirtyBar.discard')}
          title={t('appDetail.dirtyBar.discard')}
        >
          <X size={14} strokeWidth={2.25} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="app-detail-dirty-bar__action app-detail-dirty-bar__action--primary"
          onClick={() => void onSave()}
          disabled={saving}
          aria-label={t('appDetail.dirtyBar.save')}
          title={t('appDetail.dirtyBar.save')}
          aria-busy={saving || undefined}
        >
          {saving ? (
            <DotMatrixLoader size="tiny" className="app-detail-dirty-bar__spinner" />
          ) : (
            <Check size={14} strokeWidth={2.5} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
