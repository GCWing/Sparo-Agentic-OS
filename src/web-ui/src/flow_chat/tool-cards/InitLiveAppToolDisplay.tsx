/**
 * InitLiveAppToolDisplay — InitLiveApp tool result; layout aligned with GitToolDisplay (BaseToolCard).
 */
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow, ExternalLink } from 'lucide-react';
import type { ToolCardProps } from '../types/flow-chat';
import { useOverlayManager } from '@/app/hooks/useOverlayManager';
import type { OverlaySceneId } from '@/app/overlay/types';
import { ToolActionGroup } from './ToolActionGroup';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolRightRail } from './ToolRightRail';
import { ToolStructuredDetails } from './ToolStructuredDetails';
import { DetailToolTemplate } from './templates';
import './InitLiveAppToolDisplay.scss';

export const InitLiveAppDisplay: React.FC<ToolCardProps> = ({ toolItem, sessionId }) => {
  const { t } = useTranslation('flow-chat');
  const { status, toolResult, partialParams, isParamsStreaming, toolCall } = toolItem;
  const { openOverlay } = useOverlayManager();

  const toolId = toolItem.id ?? toolCall?.id;

  const name = useMemo(() => {
    if (isParamsStreaming) return (partialParams?.name as string | undefined) || '';
    return (toolCall?.input as Record<string, unknown> | undefined)?.name as string | undefined || '';
  }, [isParamsStreaming, partialParams, toolCall?.input]);

  const appId = toolResult?.result?.app_id as string | undefined;
  const path = toolResult?.result?.path as string | undefined;
  const success = toolResult?.success === true;
  const isLoading = status === 'running' || status === 'streaming' || status === 'preparing';
  const isFailed = status === 'error' || (status === 'completed' && toolResult != null && toolResult.success === false);
  const canOpenDebugPanel = status === 'completed' && success && Boolean(appId);

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
          {success && appId && status === 'completed' && (
            <span className="output-summary" title={appId}>
              {appId}
            </span>
          )}
          {canOpenDebugPanel && (
            <ToolRightRail
              label={t('toolCards.liveAppStudio.openDebugPanel')}
              onClick={handleOpenDebugPanel}
            />
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
              onClick: () => openOverlay(`live-app:${appId}` as OverlaySceneId),
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
    <DetailToolTemplate
      toolId={toolId}
      toolName={toolItem.toolName}
      status={status}
      icon={<AppWindow size={16} />}
      iconClassName="init-live-app-icon"
      action={`${t('toolCards.initLiveApp.title')}:`}
      subject={subject}
      extra={extra}
      className="init-live-app-tool-display"
      expandedContent={success && appId ? successContent() : undefined}
      errorContent={isFailed ? errorContent() : undefined}
      isFailed={isFailed}
    />
  );
};
