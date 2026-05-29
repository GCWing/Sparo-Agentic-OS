/**
 * InitLiveAppToolDisplay — InitLiveApp tool result; layout aligned with GitToolDisplay (BaseToolCard).
 */
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow, ChevronRight, ExternalLink } from 'lucide-react';
import type { ToolCardProps } from '../types/flow-chat';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { ToolActionGroup } from './ToolActionGroup';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolStructuredDetails } from './ToolStructuredDetails';
import {
  HeavyToolCardTemplate,
  renderHeavyToolRunningStatus,
} from './templates';
import { deriveToolRuntimeState } from '../runtime/statusModel';
import { getToolViewState } from '../runtime/toolViewState';
import './InitLiveAppToolDisplay.scss';

export const InitLiveAppDisplay: React.FC<ToolCardProps> = ({ toolItem, sessionId }) => {
  const { t } = useTranslation('flow-chat');
  const { status, toolResult, toolCall } = toolItem;
  const runtimeState = useMemo(() => deriveToolRuntimeState(toolItem), [toolItem]);
  const viewState = useMemo(() => getToolViewState(toolItem), [toolItem]);
  const isCompleted = viewState.phase === 'result';

  const toolId = toolItem.id ?? toolCall?.id;

  const name = useMemo(() => {
    const partialInput = runtimeState.partialInput as Record<string, unknown> | undefined;
    const parsedInput = runtimeState.input as Record<string, unknown> | undefined;
    return (runtimeState.inputPhase === 'streaming' ? partialInput?.name : parsedInput?.name) as string | undefined || '';
  }, [runtimeState.input, runtimeState.inputPhase, runtimeState.partialInput]);

  const appId = toolResult?.result?.app_id as string | undefined;
  const path = toolResult?.result?.path as string | undefined;
  const success = toolResult?.success === true;
  const isLoading = viewState.phase === 'running' || viewState.phase === 'receiving_input' || viewState.phase === 'preparing';
  const isFailed = viewState.phase === 'error' || (isCompleted && toolResult != null && toolResult.success === false);
  const canOpenDebugPanel = isCompleted && success && Boolean(appId);

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

  const getErrorMessage = () => {
    if (toolResult && 'error' in toolResult && toolResult.error) {
      return String(toolResult.error);
    }
    return t('toolCards.initLiveApp.createFailed');
  };

  const commandText = useMemo(() => {
    if (isLoading) {
      return name || t('toolCards.initLiveApp.creatingShort');
    }
    if (isFailed) {
      return name || t('toolCards.initLiveApp.untitled');
    }
    return name || appId || t('toolCards.initLiveApp.untitled');
  }, [appId, isFailed, isLoading, name, t]);

  const subject = (
        <span className="init-live-app-tool-info">
          <span className="operation-tag">
            {isLoading
              ? t('toolCards.initLiveApp.operationInit')
              : isFailed
                ? t('toolCards.initLiveApp.operationInit')
                : t('toolCards.initLiveApp.skeletonReady')}
          </span>
          <span className="command-text">{commandText}</span>
        </span>
  );

  const extra = (
        <>
          {success && appId && isCompleted && (
            <span className="output-summary" title={appId}>
              {appId}
            </span>
          )}
          {isFailed && (
            <div className="error-indicator">
              <span className="error-text">{t('toolCards.initLiveApp.failed')}</span>
            </div>
          )}
        </>
  );

  const successContent = () => {
    if (!appId) return null;
    const rows = [
      { label: t('toolCards.initLiveApp.labelAppId'), value: appId },
      ...(path ? [{ label: t('toolCards.initLiveApp.labelPath'), value: path }] : []),
    ];

    return (
      <div className="init-live-app-result-container">
        <ToolStructuredDetails rows={rows} />
        <div className="init-live-app-result-footer init-live-app-action-buttons">
          <ToolActionGroup
            actions={[{
              key: 'open-live-app',
              label: t('toolCards.initLiveApp.openInLiveApp'),
              icon: <ExternalLink size={12} />,
              onClick: () => openWorkspaceScene(`live-app:${appId}` as WorkspaceSceneId),
              title: t('toolCards.initLiveApp.openInLiveAppTitle'),
            }]}
          />
        </div>
      </div>
    );
  };

  const errorContent = () => (
    <ToolErrorBlock
      message={getErrorMessage()}
      details={name ? t('toolCards.initLiveApp.nameLabel', { name }) : undefined}
    />
  );

  return (
    <HeavyToolCardTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      icon={<AppWindow size={16} />}
      title={subject}
      meta={extra}
      isRunning={isLoading}
      showHeaderExpandHint={Boolean((success && appId) || isFailed)}
      headerRail={canOpenDebugPanel ? {
        label: t('toolCards.liveAppStudio.openDebugPanel'),
        onClick: handleOpenDebugPanel,
        icon: (
          <>
            <ChevronRight size={18} strokeWidth={2} absoluteStrokeWidth />
            <div className="task-status-icon task-status-icon--rail">
              {renderHeavyToolRunningStatus(isLoading)}
            </div>
          </>
        ),
      } : undefined}
      className="init-live-app-tool-display"
      expandedContent={success && appId ? successContent() : undefined}
      errorContent={isFailed ? errorContent() : undefined}
      isFailed={isFailed}
    />
  );
};
