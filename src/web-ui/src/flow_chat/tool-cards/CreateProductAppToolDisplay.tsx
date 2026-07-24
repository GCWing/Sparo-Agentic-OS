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
import { resolveToolSessionAppScope } from './appBuilderToolScope';
import { openActiveAuxiliaryItem } from '@/app/auxiliary-surface';
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
  const version = toolResult?.result?.version as string | undefined;
  const primarySurfaceId = toolResult?.result?.primary_surface_id as string | undefined;
  const componentLockDigest = toolResult?.result?.component_lock_digest as string | undefined;
  const primarySurfaceMode = toolResult?.result?.primary_surface_mode as string | undefined;
  const launchKind = toolResult?.result?.launch_kind as string | undefined;
  const success = toolResult?.success === true;
  const isLoading = viewState.phase === 'running' || viewState.phase === 'receiving_input' || viewState.phase === 'preparing';
  const isFailed = viewState.phase === 'error' || (isCompleted && toolResult != null && toolResult.success === false);
  const canOpenBuilder = isCompleted && success && Boolean(appId);
  const appScope = useMemo(() => resolveToolSessionAppScope(sessionId), [sessionId]);

  const handleOpenBuilder = useCallback(() => {
    if (!canOpenBuilder || !appId) return;

    const duplicateCheckKey = `app-builder:${sessionId ?? `${appId}:${appScopeIdentity(appScope)}`}`;
    openActiveAuxiliaryItem({
        type: 'app-builder',
        title: t('toolCards.appBuilder.builderTitle'),
        data: {
          sessionId: sessionId ?? null,
          appId,
          scope: appScope,
          productAppFacts: {
            appId,
            version,
            primarySurfaceId,
            componentLockDigest,
            primarySurfaceMode,
            launchKind,
            packagePath: path,
          },
        },
        metadata: {
          appBuilderSessionId: sessionId,
          appBuilderAppId: appId,
          appScope,
          productAppFacts: {
            appId,
            version,
            primarySurfaceId,
            componentLockDigest,
            primarySurfaceMode,
            launchKind,
            packagePath: path,
          },
        },
        duplicateCheckKey,
        replaceExisting: true,
    });
  }, [appId, appScope, canOpenBuilder, componentLockDigest, launchKind, path, primarySurfaceId, primarySurfaceMode, sessionId, t, version]);

  const getErrorMessage = () => {
    if (toolResult && 'error' in toolResult && toolResult.error) {
      return String(toolResult.error);
    }
    return t('toolCards.createProductApp.createFailed');
  };

  const commandText = useMemo(() => {
    if (isLoading) {
      return name || t('toolCards.createProductApp.creatingShort');
    }
    if (isFailed) {
      return name || t('toolCards.createProductApp.untitled');
    }
    return name || appId || t('toolCards.createProductApp.untitled');
  }, [appId, isFailed, isLoading, name, t]);

  const subject = (
        <span className="create-product-app-tool-info">
          <span className="operation-tag">
            {isLoading
              ? t('toolCards.createProductApp.operationInit')
              : isFailed
                ? t('toolCards.createProductApp.operationInit')
                : t('toolCards.createProductApp.skeletonReady')}
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
              <span className="error-text">{t('toolCards.createProductApp.failed')}</span>
            </div>
          )}
        </>
  );

  const successContent = () => {
    if (!appId) return null;
    const rows = [
      { label: t('toolCards.createProductApp.labelAppId'), value: appId },
      ...(version ? [{ label: t('toolCards.createProductApp.labelVersion'), value: version }] : []),
      ...(primarySurfaceId ? [{ label: t('toolCards.createProductApp.labelPrimarySurface'), value: primarySurfaceId }] : []),
      ...(primarySurfaceMode ? [{ label: t('toolCards.createProductApp.labelSurfaceMode'), value: primarySurfaceMode }] : []),
      ...(launchKind ? [{ label: t('toolCards.createProductApp.labelLaunchKind'), value: launchKind }] : []),
      ...(componentLockDigest ? [{ label: t('toolCards.createProductApp.labelLockDigest'), value: componentLockDigest }] : []),
      ...(path ? [{ label: t('toolCards.createProductApp.labelPath'), value: path }] : []),
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
      details={name ? t('toolCards.createProductApp.nameLabel', { name }) : undefined}
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
      headerRail={canOpenBuilder ? {
        label: t('toolCards.appBuilder.openBuilder'),
        onClick: handleOpenBuilder,
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
