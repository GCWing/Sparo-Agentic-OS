/**
 * SessionScene �?Session scene layout.
 *
 * Layout (left to right):
 *   ChatPane (flex:1, FlowChat conversation)
 *   PaneResizer (draggable divider)
 *   AuxPane (variable width, ContentCanvas tabs)
 *
 * Per-agent behavior (styling, aux-tab lifecycle, capabilities) is driven by
 * the active SessionProfile �?see src/app/session-profiles/.
 */

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../hooks/useApp';
import { useSessionProfile } from '../../session-profiles';
import { useSessionGoalSnapshot } from '@/flow_chat/store/sessionGoalStore';
import ChatPane from './ChatPane';
import AuxPane, { type AuxPaneRef } from './AuxPane';

import {
  RIGHT_PANEL_CONFIG,
  WIDE_WORKBENCH_RIGHT_PANEL_CONFIG,
  WIDE_WORKBENCH_PRODUCT_APP_IDS,
  PANEL_COMMON_CONFIG,
  STORAGE_KEYS,
  PanelDisplayMode,
  getPanelDisplayMode,
  getModeWidth,
  getSnappedWidth,
  getNextMode,
  savePanelWidth,
  loadPanelWidth,
} from '../../layout/panelConfig';
import { useActiveSession } from '@/flow_chat/store/modernFlowChatStore';
import {
  isSessionTranscriptLoading,
  isSessionTranscriptReady,
} from '@/flow_chat/domain/sessionLoadPhase';
import { DotMatrixLoader } from '@/design-system';
import { useCanvasStore } from '@/app/components/panels/content-canvas';

import './SessionScene.scss';


interface SessionSceneProps {
  workspacePath?: string;
  surfaceSessionId?: string | null;
  isEntering?: boolean;
  isActive?: boolean;
}

const SessionScene: React.FC<SessionSceneProps> = ({
  workspacePath,
  surfaceSessionId,
  isEntering = false,
  isActive = true,
}) => {
  const { t } = useTranslation('flow-chat');
  const { state, updateRightPanelWidth, toggleRightPanel } = useApp();
  const { profile } = useSessionProfile();
  const activeSession = useActiveSession();
  const [auxPaneReleasedSessionId, setAuxPaneReleasedSessionId] = useState<string | null>(null);
  const hasBoundProductAppTab = useCanvasStore(state => (
    [state.primaryGroup, state.secondaryGroup, state.tertiaryGroup].some(group => (
      group.tabs.some(tab => (
        tab.content.type === 'product-app-runtime' &&
        tab.content.metadata?.boundSessionId === surfaceSessionId
      ))
    ))
  ));
  const productAppId = activeSession?.customMetadata?.productAppRuntime?.appId;
  const isTranscriptLoading = Boolean(surfaceSessionId) && (
    activeSession?.sessionId !== surfaceSessionId ||
    isSessionTranscriptLoading(activeSession)
  );
  const transcriptAcceptsInput = Boolean(surfaceSessionId) && (
    activeSession?.sessionId === surfaceSessionId
    && isSessionTranscriptReady(activeSession)
  );
  useEffect(() => {
    if (surfaceSessionId && !isTranscriptLoading) {
      setAuxPaneReleasedSessionId(surfaceSessionId);
    }
  }, [isTranscriptLoading, surfaceSessionId]);
  const auxPaneReleased = !surfaceSessionId || auxPaneReleasedSessionId === surfaceSessionId;
  const isSessionSurfaceLoading = !auxPaneReleased || (
    Boolean(productAppId) && !hasBoundProductAppTab
  );
  const goalSnapshot = useSessionGoalSnapshot(surfaceSessionId);
  // Once the goal is completed the session returns to its normal look: drop the
  // focus frame. The banner stays (neutral) so the result is still visible/clearable.
  const hasGoalMode = goalSnapshot.phase !== 'none' && goalSnapshot.phase !== 'completed';
  const auxPaneRef = useRef<AuxPaneRef>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const rightPanelConfig = useMemo(
    () => (
      productAppId && WIDE_WORKBENCH_PRODUCT_APP_IDS.has(productAppId)
        ? WIDE_WORKBENCH_RIGHT_PANEL_CONFIG
        : RIGHT_PANEL_CONFIG
    ),
    [productAppId],
  );

  const [, setLastRightWidth] = useState<number>(() =>
    loadPanelWidth(STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH, RIGHT_PANEL_CONFIG.COMFORTABLE_DEFAULT)
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const resizerRef = useRef<HTMLDivElement>(null);
  const auxPaneElementRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const autoSizedWorkbenchRef = useRef<string | null>(null);

  const currentRightWidth = state.layout.rightPanelWidth || rightPanelConfig.COMFORTABLE_DEFAULT;

  const rightPanelMode: PanelDisplayMode = useMemo(() => {
    if (state.layout.rightPanelCollapsed) return 'collapsed';
    return getPanelDisplayMode(currentRightWidth, rightPanelConfig);
  }, [state.layout.rightPanelCollapsed, currentRightWidth, rightPanelConfig]);

  // Keep right panel visible when chat is hidden
  useEffect(() => {
    if (state.layout.chatCollapsed && state.layout.rightPanelCollapsed) {
      toggleRightPanel();
    }
  }, [state.layout.chatCollapsed, state.layout.rightPanelCollapsed, toggleRightPanel]);

  const calculateValidRightWidth = useCallback((newWidth: number): number => {
    if (!containerRef.current) return newWidth;
    const containerWidth = containerRef.current.offsetWidth;
    if (containerWidth <= 0) return newWidth;
    const reserved = PANEL_COMMON_CONFIG.RESIZER_WIDTH + PANEL_COMMON_CONFIG.MIN_CENTER_WIDTH;
    const dynamicMax = containerWidth - reserved;
    const maxWidth =
      dynamicMax < rightPanelConfig.COMPACT_WIDTH
        ? rightPanelConfig.MAX_WIDTH
        : Math.min(rightPanelConfig.MAX_WIDTH, dynamicMax);
    return Math.min(maxWidth, Math.max(rightPanelConfig.COMPACT_WIDTH, newWidth));
  }, [rightPanelConfig]);

  const saveAndUpdateRightWidth = useCallback((width: number) => {
    updateRightPanelWidth(width);
    setLastRightWidth(width);
    savePanelWidth(STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH, width);
  }, [updateRightPanelWidth]);

  const handleDoubleClick = useCallback(() => {
    const nextMode = getNextMode(rightPanelMode);
    const targetWidth = getModeWidth(nextMode, rightPanelConfig);
    saveAndUpdateRightWidth(calculateValidRightWidth(targetWidth));
  }, [rightPanelMode, rightPanelConfig, calculateValidRightWidth, saveAndUpdateRightWidth]);

  // Canvas-first Product Apps should enter at a usable workbench width.
  useEffect(() => {
    if (!productAppId || !WIDE_WORKBENCH_PRODUCT_APP_IDS.has(productAppId)) {
      autoSizedWorkbenchRef.current = null;
      return;
    }
    const workbenchKey = `${surfaceSessionId ?? 'active'}:${productAppId}`;
    if (autoSizedWorkbenchRef.current === workbenchKey) return;
    autoSizedWorkbenchRef.current = workbenchKey;
    if ((state.layout.rightPanelWidth || 0) >= WIDE_WORKBENCH_RIGHT_PANEL_CONFIG.COMFORTABLE_DEFAULT) {
      return;
    }
    saveAndUpdateRightWidth(
      calculateValidRightWidth(WIDE_WORKBENCH_RIGHT_PANEL_CONFIG.COMFORTABLE_DEFAULT),
    );
  }, [
    productAppId,
    surfaceSessionId,
    state.layout.rightPanelWidth,
    calculateValidRightWidth,
    saveAndUpdateRightWidth,
  ]);

  useEffect(() => {
    const handleProductAppPanelMode = (event: Event) => {
      const detail = (event as CustomEvent<{ appId?: string; mode?: PanelDisplayMode }>).detail;
      if (!productAppId || detail?.appId !== productAppId) return;
      if (detail.mode !== 'comfortable' && detail.mode !== 'expanded') return;
      const targetWidth = getModeWidth(detail.mode, rightPanelConfig);
      saveAndUpdateRightWidth(calculateValidRightWidth(targetWidth));
    };
    window.addEventListener('product-app-request-panel-mode', handleProductAppPanelMode);
    return () => window.removeEventListener('product-app-request-panel-mode', handleProductAppPanelMode);
  }, [productAppId, rightPanelConfig, calculateValidRightWidth, saveAndUpdateRightWidth]);

  const handleMouseDownResizer = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const startX = e.clientX;
    const startWidth = currentRightWidth;
    let lastValidWidth = startWidth;

    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(() => {
        const valid = calculateValidRightWidth(startWidth + (startX - ev.clientX));
        lastValidWidth = valid;
        if (auxPaneElementRef.current && !state.layout.chatCollapsed) {
          auxPaneElementRef.current.style.width = `${valid}px`;
        } else {
          updateRightPanelWidth(valid);
        }
        animationFrameRef.current = null;
      });
    };

    const onUp = () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const snapped = getSnappedWidth(lastValidWidth, rightPanelConfig, false);
      if (snapped !== lastValidWidth) {
        saveAndUpdateRightWidth(snapped);
      } else {
        updateRightPanelWidth(lastValidWidth);
        setLastRightWidth(lastValidWidth);
        savePanelWidth(STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH, lastValidWidth);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => setIsDragging(false)));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [
    currentRightWidth,
    calculateValidRightWidth,
    updateRightPanelWidth,
    saveAndUpdateRightWidth,
    state.layout.chatCollapsed,
    rightPanelConfig,
  ]);

  // No-animation expansion
  const [isAuxPaneExpandingImmediate, setIsAuxPaneExpandingImmediate] = useState(false);

  useEffect(() => {
    const handler = (event: CustomEvent) => {
      if (event.detail?.noAnimation && state.layout.rightPanelCollapsed) {
        setIsAuxPaneExpandingImmediate(true);
        setTimeout(() => setIsAuxPaneExpandingImmediate(false), 0);
      }
    };
    window.addEventListener('expand-right-panel-immediate', handler as EventListener);
    return () => window.removeEventListener('expand-right-panel-immediate', handler as EventListener);
  }, [state.layout.rightPanelCollapsed]);

  // Responsive resize �?also validate on mount to clamp widths restored from localStorage.
  useEffect(() => {
    const validate = () => {
      const valid = calculateValidRightWidth(currentRightWidth);
      if (valid !== currentRightWidth) updateRightPanelWidth(valid);
    };
    const rafId = requestAnimationFrame(validate);
    window.addEventListener('resize', validate);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', validate);
    };
  }, [currentRightWidth, calculateValidRightWidth, updateRightPanelWidth]);

  // Cleanup animation frames
  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  const isRightAsMain = state.layout.chatCollapsed;
  const isChatHidden = state.layout.centerPanelCollapsed || isRightAsMain;

  const panelModeLabels = useMemo(() => ({
    collapsed:    t('layout.panelMode.collapsed'),
    compact:      t('layout.panelMode.compact'),
    comfortable:  t('layout.panelMode.comfortable'),
    expanded:     t('layout.panelMode.expanded'),
  }), [t]);

  const panelCollapseHintStyles = useMemo(() => {
    const q = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
    return {
      ['--panel-collapse-hint-right' as any]: q(t('layout.panelCollapseHintRight')),
    } as React.CSSProperties;
  }, [t]);

  const rootStyle = useMemo(() => ({
    ...panelCollapseHintStyles,
    ...profile.theme.cssVars,
  }), [panelCollapseHintStyles, profile.theme.cssVars]);

  return (
    <div
      ref={containerRef}
      className={[
        'sparo-session-scene',
        isDragging && 'sparo-session-scene--dragging',
        hasGoalMode && 'sparo-session-scene--goal-mode',
        isEntering && 'layout-entering',
      ].filter(Boolean).join(' ')}
      data-agent={profile.theme.dataAgent}
      data-testid="session-scene"
      data-goal-phase={goalSnapshot.phase}
      style={rootStyle}
    >
      {/* ChatPane �?FlowChat conversation */}
      {!isChatHidden && (
        <div
          className={`sparo-session-scene__chat-pane ${isDragging ? 'sparo-session-scene__chat-pane--dragging' : ''}`}
        >
          <ChatPane
            width={0}
            isFullscreen={false}
            isDragging={false}
            workspacePath={workspacePath}
            sessionId={surfaceSessionId}
            showChatInput={transcriptAcceptsInput}
          />
        </div>
      )}

      {/* Resizer �?always rendered (when chat visible) for slide animation */}
      {!isChatHidden && (
        <div
          ref={resizerRef}
          className={[
            'sparo-pane-resizer',
            state.layout.rightPanelCollapsed && 'sparo-pane-resizer--collapsed',
            isDragging && 'sparo-pane-resizer--dragging',
            isHovering && 'sparo-pane-resizer--hovering',
          ].filter(Boolean).join(' ')}
          onMouseDown={handleMouseDownResizer}
          onDoubleClick={handleDoubleClick}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
          tabIndex={state.layout.rightPanelCollapsed ? -1 : 0}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('layout.resizer.rightAriaLabel')}
          aria-valuenow={currentRightWidth}
          aria-valuemin={rightPanelConfig.COMPACT_WIDTH}
          aria-valuemax={rightPanelConfig.MAX_WIDTH}
          title={t('layout.resizer.title', { mode: panelModeLabels[rightPanelMode] })}
        >
          <div className="sparo-pane-resizer__line" />
          <div className="sparo-pane-resizer__handle">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="sparo-pane-resizer__icon">
              <circle cx="6" cy="4" r="1" fill="currentColor" />
              <circle cx="6" cy="8" r="1" fill="currentColor" />
              <circle cx="6" cy="12" r="1" fill="currentColor" />
              <circle cx="10" cy="4" r="1" fill="currentColor" />
              <circle cx="10" cy="8" r="1" fill="currentColor" />
              <circle cx="10" cy="12" r="1" fill="currentColor" />
            </svg>
          </div>
        </div>
      )}

      {/* AuxPane �?ContentCanvas */}
      <div
        ref={auxPaneElementRef}
        className={[
          'sparo-session-scene__aux-pane',
          state.layout.rightPanelCollapsed         && 'sparo-session-scene__aux-pane--collapsed',
          isDragging                               && 'sparo-session-scene__aux-pane--dragging',
          isRightAsMain                            && 'sparo-session-scene__aux-pane--editor-mode',
          isAuxPaneExpandingImmediate              && 'sparo-session-scene__aux-pane--no-animation',
        ].filter(Boolean).join(' ')}
        style={{
          width: state.layout.rightPanelCollapsed
            ? undefined
            : isRightAsMain ? undefined : `${currentRightWidth}px`,
        }}
        data-mode={rightPanelMode}
      >
        {auxPaneReleased ? (
          <AuxPane
            ref={auxPaneRef}
            workspacePath={workspacePath}
            isSceneActive={isActive}
          />
        ) : null}
        {isSessionSurfaceLoading ? (
          <div
            className="sparo-session-scene__aux-loading"
            role="status"
            aria-live="polite"
            aria-label={t('session.loadingSurface')}
          >
            <DotMatrixLoader size="small" />
            <span>{t('session.loadingSurface')}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default SessionScene;
