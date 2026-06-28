import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow, ChevronRight } from 'lucide-react';
import type { ToolCardProps } from '../types/flow-chat';
import { appScopeIdentity } from '@/shared/types/app-scope';
import { ToolErrorBlock } from './ToolErrorBlock';
import { ToolStructuredDetails } from './ToolStructuredDetails';
import {
  HeavyToolCardTemplate,
  renderHeavyToolRunningStatus,
} from './templates';
import { deriveToolRuntimeState } from '../runtime/statusModel';
import { getToolViewState } from '../runtime/toolViewState';
import { resolveToolSessionAppScope } from './surfaceComponentToolScope';
import './CreateProductAppToolDisplay.scss';

export const CreateProductAppDisplay: React.FC<ToolCardProps> = ({ toolItem, sessionId }) => {
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
  const appScope = useMemo(() => resolveToolSessionAppScope(sessionId), [sessionId]);

  const handleOpenDebugPanel = useCallback(() => {
    if (!canOpenDebugPanel || !appId) return;

    const duplicateCheckKey = `app-studio:${sessionId ?? `${appId}:${appScopeIdentity(appScope)}`}`;
    window.dispatchEvent(new CustomEvent('agent-create-tab', {
      detail: {
        type: 'app-studio',
        title: t('toolCards.appStudio.debugPanelTitle'),
        data: {
          sessionId: sessionId ?? null,
          appId,
          scope: appScope,
        },
        metadata: {
          appStudioSessionId: sessionId,
          appStudioAppId: appId,
          appScope,
        },
        checkDuplicate: true,
        duplicateCheckKey,
        replaceExisting: true,
      },
    }));
  }, [appId, appScope, canOpenDebugPanel, sessionId, t]);

  const getErrorMessage = () => {
    if (toolResult && 'error' in toolResult && toolResult.error) {
      return String(toolResult.error);
    }
    return t('toolCards.initSurfaceComponent.createFailed');
  };

  const commandText = useMemo(() => {
    if (isLoading) {
      return name || t('toolCards.initSurfaceComponent.creatingShort');
    }
    if (isFailed) {
      return name || t('toolCards.initSurfaceComponent.untitled');
    }
    return name || appId || t('toolCards.initSurfaceComponent.untitled');
  }, [appId, isFailed, isLoading, name, t]);

  const subject = (
        <span className="create-product-app-tool-info">
          <span className="operation-tag">
            {isLoading
              ? t('toolCards.initSurfaceComponent.operationInit')
              : isFailed
                ? t('toolCards.initSurfaceComponent.operationInit')
                : t('toolCards.initSurfaceComponent.skeletonReady')}
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
              <span className="error-text">{t('toolCards.initSurfaceComponent.failed')}</span>
            </div>
          )}
        </>
  );

  const successContent = () => {
    if (!appId) return null;
    const rows = [
      { label: t('toolCards.initSurfaceComponent.labelAppId'), value: appId },
      ...(path ? [{ label: t('toolCards.initSurfaceComponent.labelPath'), value: path }] : []),
    ];

    return (
      <div className="create-product-app-result-container">
        <ToolStructuredDetails rows={rows} />
      </div>
    );
  };

  const errorContent = () => (
    <ToolErrorBlock
      message={getErrorMessage()}
      details={name ? t('toolCards.initSurfaceComponent.nameLabel', { name }) : undefined}
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
        label: t('toolCards.appStudio.openDebugPanel'),
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
      className="create-product-app-tool-display"
      expandedContent={success && appId ? successContent() : undefined}
      errorContent={isFailed ? errorContent() : undefined}
      isFailed={isFailed}
    />
  );
};
