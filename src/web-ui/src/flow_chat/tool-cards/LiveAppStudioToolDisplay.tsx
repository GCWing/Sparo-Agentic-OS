import React, { useCallback, useMemo } from 'react';
import { AppWindow, Camera, ChevronRight, RefreshCw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ToolCardProps } from '../types/flow-chat';
import { ToolStructuredDetails } from './ToolStructuredDetails';
import {
  DefaultToolCardTemplate,
  HeavyToolCardTemplate,
  renderHeavyToolRunningStatus,
} from './templates';
import './LiveAppStudioToolDisplay.scss';

const EMPTY_TOOL_RESULT: Record<string, unknown> = {};

const TOOL_LABELS: Record<string, { icon: React.ReactNode; tagKey: string }> = {
  LiveAppRecompile: {
    icon: <RefreshCw size={16} />,
    tagKey: 'recompile',
  },
  LiveAppRuntimeProbe: {
    icon: <ShieldAlert size={16} />,
    tagKey: 'probe',
  },
  LiveAppScreenshotMatrix: {
    icon: <Camera size={16} />,
    tagKey: 'matrix',
  },
};

function formatByteSize(bytes: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const maximumFractionDigits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value)} ${units[unitIndex]}`;
}

function formatIssueValue(issue: unknown): string {
  if (!issue || typeof issue !== 'object') return String(issue ?? '');
  const value = issue as Record<string, unknown>;
  const category = typeof value.category === 'string' ? value.category : 'runtime';
  const message = typeof value.message === 'string' ? value.message : 'Unknown runtime issue';
  const source = typeof value.source === 'string' && value.source ? `\nSource: ${value.source}` : '';
  const stack = typeof value.stack === 'string' && value.stack ? `\nStack:\n${value.stack}` : '';
  return `[${category}] ${message}${source}${stack}`;
}

function renderProbeIssues(result: Record<string, unknown>): React.ReactNode {
  const fatal = Array.isArray(result.fatal) ? result.fatal : [];
  const warning = Array.isArray(result.warning) ? result.warning : [];
  const groups = [
    { key: 'fatal', issues: fatal },
    { key: 'warning', issues: warning },
  ].filter((group) => group.issues.length > 0);

  if (groups.length === 0) return null;

  return (
    <div className="live-app-studio-probe-details">
      {groups.map((group) => (
        <section key={group.key} className={`live-app-studio-probe-group is-${group.key}`}>
          <div className="live-app-studio-probe-group__title">
            {group.key} · {group.issues.length}
          </div>
          {group.issues.map((issue, index) => (
            <pre key={`${group.key}-${index}`} className="live-app-studio-probe-issue">
              {formatIssueValue(issue)}
            </pre>
          ))}
        </section>
      ))}
    </div>
  );
}

export const LiveAppStudioToolDisplay: React.FC<ToolCardProps> = ({ toolItem, sessionId }) => {
  const { t, i18n } = useTranslation('flow-chat');
  const { status, toolResult, toolCall, partialParams, isParamsStreaming } = toolItem;
  const toolName = toolItem.toolName;
  const label = TOOL_LABELS[toolName] ?? {
    icon: <AppWindow size={16} />,
    tagKey: '',
  };
  const actionLabel = t('toolCards.liveAppStudio.title');
  const tagLabel = label.tagKey
    ? t(`toolCards.liveAppStudio.${label.tagKey}`)
    : toolName;

  const result = (toolResult?.result ?? EMPTY_TOOL_RESULT) as Record<string, unknown>;
  const input = (isParamsStreaming ? partialParams : toolCall?.input) as Record<string, unknown> | undefined;
  const appId = (result.app_id as string | undefined) ?? (input?.app_id as string | undefined);
  const isFailed = status === 'error' || (status === 'completed' && toolResult != null && toolResult.success === false);
  const canOpenDebugPanel = toolName === 'LiveAppRecompile' && Boolean(appId);

  const handleOpenDebugPanel = useCallback(() => {
    if (!canOpenDebugPanel || !appId) return;

    const duplicateCheckKey = `live-app-studio:${sessionId ?? appId}`;
    window.dispatchEvent(new CustomEvent('agent-create-tab', {
      detail: {
        type: 'live-app-studio',
        title: t('toolCards.liveAppStudio.debugPanelTitle'),
        data: {
          sessionId: sessionId ?? null,
          appId,
        },
        metadata: {
          liveAppStudioSessionId: sessionId,
          liveAppStudioAppId: appId,
        },
        checkDuplicate: true,
        duplicateCheckKey,
        replaceExisting: true,
      },
    }));
  }, [appId, canOpenDebugPanel, sessionId, t]);

  const summary = useMemo(() => {
    if (toolName === 'LiveAppRecompile') {
      const size = result.compiled_html_size as number | undefined;
      return size ? t('toolCards.liveAppStudio.compiledSize', { size: formatByteSize(size, i18n.language) }) : appId || t('toolCards.liveAppStudio.syncing');
    }
    if (toolName === 'LiveAppRuntimeProbe') {
      const fatal = Array.isArray(result.fatal) ? result.fatal.length : 0;
      const warning = Array.isArray(result.warning) ? result.warning.length : 0;
      const noise = typeof result.noise_count === 'number' ? result.noise_count : 0;
      return t('toolCards.liveAppStudio.probeSummary', { fatal, warning, noise });
    }
    if (toolName === 'LiveAppScreenshotMatrix') {
      const screenshots = Array.isArray(result.screenshots) ? result.screenshots.length : 0;
      return screenshots
        ? t('toolCards.liveAppStudio.matrixStates', { count: screenshots })
        : t('toolCards.liveAppStudio.matrixRequested');
    }
    return appId || '';
  }, [appId, i18n.language, result, toolName, t]);

  const detailRows = Object.entries(result)
    .filter(([, value]) => value !== null && value !== undefined)
    .slice(0, 8);
  const hasExpandableDetails = detailRows.length > 0;
  const probeDetails = toolName === 'LiveAppRuntimeProbe' ? renderProbeIssues(result) : null;
  const hasProbeDetails = Boolean(probeDetails);

  if (toolName === 'LiveAppRuntimeProbe') {
    return (
      <DefaultToolCardTemplate
        toolId={toolItem.id ?? toolCall?.id}
        toolName={toolName}
        status={status}
        action={`${actionLabel}:`}
        summary={
          <span className="live-app-studio-tool-info">
            <span className="operation-tag">{tagLabel}</span>
            <span className="command-text">{summary}</span>
          </span>
        }
        className="live-app-studio-probe-compact"
        expandedContent={hasProbeDetails ? probeDetails : undefined}
      />
    );
  }

  return (
    <HeavyToolCardTemplate
      toolId={toolItem.id ?? toolCall?.id}
      toolName={toolName}
      status={status}
      isFailed={isFailed}
      className={`live-app-studio-tool-display${canOpenDebugPanel ? ' is-openable' : ''}`}
      icon={label.icon}
      title={
        <span className="live-app-studio-tool-info">
          <span className="operation-tag">{tagLabel}</span>
          <span className="command-text">{summary}</span>
        </span>
      }
      meta={
        !canOpenDebugPanel && appId ? (
          <div className="live-app-studio-tool-extras">
            <span className="output-summary" title={appId}>{appId}</span>
          </div>
        ) : undefined
      }
      showHeaderExpandHint={hasExpandableDetails}
      isRunning={status === 'preparing' || status === 'streaming' || status === 'running'}
      headerRail={canOpenDebugPanel ? {
        label: t('toolCards.liveAppStudio.openDebugPanel'),
        onClick: handleOpenDebugPanel,
        icon: (
          <>
            <ChevronRight size={18} strokeWidth={2} absoluteStrokeWidth />
            <div className="task-status-icon task-status-icon--rail">
              {renderHeavyToolRunningStatus(status === 'preparing' || status === 'streaming' || status === 'running')}
            </div>
          </>
        ),
      } : undefined}
      expandedContent={
        hasExpandableDetails ? (
          <ToolStructuredDetails
            rows={detailRows.map(([key, value]) => ({
              label: key,
              value: typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                ? String(value)
                : JSON.stringify(value),
            }))}
          />
        ) : null
      }
    />
  );
};
