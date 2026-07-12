import React, { useMemo, useState } from 'react';
import { MailOpen, ScrollText } from 'lucide-react';
import { IconButton } from '@/design-system';
import { useDailyLetterArrivalStore } from '@/app/daily-letter-arrival/store/dailyLetterArrivalStore';
import { dailyLetterApi } from '@/app/scenes/daily-letter/dailyLetterApi';
import { todayKey } from '@/app/scenes/daily-letter/dailyLetterDateUtils';
import type {
  DailyLetterRecord,
  DailyLetterState,
} from '@/app/scenes/daily-letter/dailyLetterTypes';
import { useLastUsedWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import {
  WorkspaceHubPreviewAction,
  WorkspaceHubPreviewEmpty,
  WorkspaceHubPreviewError,
  WorkspaceHubPreviewLoading,
} from './WorkspaceHubPreviewFrame';
import type { WorkspaceHubPreviewProps } from './workspaceHubPreviewTypes';
import { useHubPreviewResource } from './useHubPreviewResource';
import './DailyLetterPreview.scss';

interface DailyLetterPreviewData {
  letters: DailyLetterRecord[] | null;
  state: DailyLetterState | null;
  lettersPartial: boolean;
  stateFailed: boolean;
}

function sortLetters(letters: DailyLetterRecord[]): DailyLetterRecord[] {
  return [...letters].sort((left, right) => (
    right.date.localeCompare(left.date) || right.updatedAtMs - left.updatedAtMs
  ));
}

function letterPreviewParagraphs(markdown: string, fallback: string): string[] {
  const paragraphs = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-+]\s+/gm, '')
      .replace(/[*_~`>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);

  return paragraphs.length > 0 ? paragraphs.slice(0, 3) : [fallback];
}

const DailyLetterPreview: React.FC<WorkspaceHubPreviewProps> = ({
  label,
  primaryActionRef,
  onOpenItem,
  onClose,
}) => {
  const { t } = useI18n('common');
  const { workspacePath } = useLastUsedWorkspace();
  const openRecord = useDailyLetterArrivalStore((state) => state.openRecord);
  const [generating, setGenerating] = useState(false);
  const [generateFailed, setGenerateFailed] = useState(false);
  const key = `workspace-hub:daily-letter:${workspacePath || 'global'}`;

  const resource = useHubPreviewResource<DailyLetterPreviewData>(key, async () => {
    const requests = [dailyLetterApi.list({ scope: 'agentic_os', limit: 4 })];
    if (workspacePath) {
      requests.push(dailyLetterApi.list({ scope: 'workspace', workspacePath, limit: 4 }));
    }

    const [letterResults, stateResult] = await Promise.all([
      Promise.allSettled(requests),
      Promise.resolve(dailyLetterApi.state()).then(
        (value) => ({ ok: true as const, value }),
        () => ({ ok: false as const, value: null }),
      ),
    ]);
    const fulfilledLetterLists = letterResults
      .filter((result): result is PromiseFulfilledResult<DailyLetterRecord[]> => result.status === 'fulfilled')
      .flatMap((result) => result.value);
    const allLetterRequestsFailed = letterResults.every((result) => result.status === 'rejected');

    if (allLetterRequestsFailed && !stateResult.ok) {
      const firstFailure = letterResults.find((result) => result.status === 'rejected');
      throw firstFailure?.status === 'rejected' ? firstFailure.reason : new Error('daily-letter-preview');
    }

    const merged = new Map<string, DailyLetterRecord>();
    fulfilledLetterLists.forEach((letter) => merged.set(letter.id, letter));
    return {
      letters: allLetterRequestsFailed ? null : sortLetters(Array.from(merged.values())),
      state: stateResult.value,
      lettersPartial: letterResults.some((result) => result.status === 'rejected'),
      stateFailed: !stateResult.ok,
    };
  });

  const today = todayKey();
  const todayLetter = useMemo(() => {
    const candidates = resource.data?.letters?.filter((letter) => letter.date === today) ?? [];
    return candidates.find((letter) => letter.scope === 'workspace') ?? candidates[0] ?? null;
  }, [resource.data?.letters, today]);
  const writing = resource.data?.state?.lastAttemptStatus === 'running'
    && resource.data.state.activeDate === today;
  const canGenerate = Boolean(
    resource.data
    && !resource.data.lettersPartial
    && !resource.loading
    && !resource.error
    && !todayLetter
    && !writing,
  );
  const previewParagraphs = useMemo(
    () => letterPreviewParagraphs(
      todayLetter?.bodyMarkdown ?? '',
      todayLetter?.preview.oneLine ?? '',
    ),
    [todayLetter?.bodyMarkdown, todayLetter?.preview.oneLine],
  );

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateFailed(false);
    try {
      const scope = workspacePath ? 'workspace' : 'agentic_os';
      await dailyLetterApi.generate({
        date: today,
        scope,
        workspacePath: scope === 'workspace' ? workspacePath : null,
        force: false,
      });
      resource.refresh();
    } catch {
      setGenerateFailed(true);
    } finally {
      setGenerating(false);
    }
  };

  const handleExpandReading = () => {
    if (!todayLetter) return;
    onClose();
    openRecord(todayLetter);
  };

  const actions = todayLetter ? (
    <WorkspaceHubPreviewAction
      accent
      arrow
      onClick={handleExpandReading}
    >
      {t('nav.menuPanel.hub.preview.dailyLetter.actions.expandReading')}
    </WorkspaceHubPreviewAction>
  ) : canGenerate ? (
    <WorkspaceHubPreviewAction
      accent
      isLoading={generating}
      loadingLabel={t('nav.menuPanel.hub.preview.dailyLetter.actions.generating')}
      onClick={() => { void handleGenerate(); }}
    >
      <ScrollText size={14} aria-hidden="true" />
      {t('nav.menuPanel.hub.preview.dailyLetter.actions.generate')}
    </WorkspaceHubPreviewAction>
  ) : (
    <WorkspaceHubPreviewAction
      accent
      arrow
      onClick={() => onOpenItem('daily-letter')}
    >
      {t('nav.menuPanel.hub.preview.dailyLetter.actions.open')}
    </WorkspaceHubPreviewAction>
  );

  return (
    <article className="sparo-workspace-hub-daily-letter-preview">
      <header className="sparo-workspace-hub-daily-letter-preview__header">
        <h2>{label}</h2>
        <IconButton
          ref={primaryActionRef}
          variant="brand"
          size="medium"
          shape="circle"
          aria-label={t('nav.menuPanel.hub.preview.dailyLetter.actions.open')}
          tooltip={t('nav.menuPanel.hub.preview.dailyLetter.actions.open')}
          tooltipPlacement="top"
          onClick={() => onOpenItem('daily-letter')}
        >
          <MailOpen size={16} aria-hidden="true" />
        </IconButton>
      </header>

      <div className="sparo-workspace-hub-daily-letter-preview__content">
        <section className="sparo-workspace-hub-daily-letter-preview__letter">
          <div className="sparo-workspace-hub-daily-letter-preview__letter-body">
            {resource.loading && !resource.data ? (
              <WorkspaceHubPreviewLoading rows={2} />
            ) : resource.error || !resource.data ? (
              <WorkspaceHubPreviewError
                message={t('nav.menuPanel.hub.preview.dailyLetter.errors.load')}
                retryLabel={t('nav.menuPanel.hub.preview.common.retry')}
                onRetry={resource.refresh}
              />
            ) : generateFailed ? (
              <WorkspaceHubPreviewError
                message={t('nav.menuPanel.hub.preview.dailyLetter.errors.generate')}
                retryLabel={t('nav.menuPanel.hub.preview.common.retry')}
                onRetry={() => { void handleGenerate(); }}
              />
            ) : todayLetter ? (
              <div className="sparo-workspace-hub-daily-letter-preview__copy">
                {previewParagraphs.map((paragraph, index) => (
                  <p key={`${index}-${paragraph.slice(0, 18)}`}>{paragraph}</p>
                ))}
              </div>
            ) : writing ? (
              <WorkspaceHubPreviewEmpty
                title={t('nav.menuPanel.hub.preview.dailyLetter.empty.writingTitle')}
              />
            ) : (
              <WorkspaceHubPreviewEmpty
                title={t('nav.menuPanel.hub.preview.dailyLetter.empty.todayTitle')}
              />
            )}
          </div>
          <footer className="sparo-workspace-hub-preview__actions">{actions}</footer>
        </section>
      </div>
    </article>
  );
};

export default DailyLetterPreview;
