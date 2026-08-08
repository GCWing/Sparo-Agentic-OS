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
import { ArrowLeft } from 'lucide-react';
import { useSessionProfile } from '../../session-profiles';
import { useSessionGoalSnapshot } from '@/flow_chat/store/sessionGoalStore';
import ChatPane from './ChatPane';
import AuxPane from './AuxPane';

import {
  AUXILIARY_SURFACE_CONFIG,
  PANEL_COMMON_CONFIG,
  PanelDisplayMode,
  getPanelDisplayMode,
  getModeWidth,
  getSnappedWidth,
  getNextMode,
} from '../../layout/panelConfig';
import { useActiveSession } from '@/flow_chat/store/modernFlowChatStore';
import {
  isSessionTranscriptLoading,
  isSessionTranscriptReady,
} from '@/flow_chat/domain/sessionLoadPhase';
import { DotMatrixLoader, IconButton } from '@/design-system';
import {
  exitActiveAuxiliarySceneFocus,
  selectActiveAuxiliaryHostState,
  useAuxiliarySurfaceStore,
} from '@/app/auxiliary-surface';

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
  const { profile } = useSessionProfile();
  const activeAuxiliaryHost = useAuxiliarySurfaceStore(selectActiveAuxiliaryHostState);
  const currentRightWidth = useAuxiliarySurfaceStore(store => store.width);
  const updateAuxiliaryWidth = useAuxiliarySurfaceStore(store => store.setWidth);
  const auxiliaryCollapsed =
    !activeAuxiliaryHost || activeAuxiliaryHost.presentation === 'closed';
  const auxiliarySceneFocused = activeAuxiliaryHost?.presentation === 'scene-focus';
  const preserveDockedLayoutDuringSceneFocus = auxiliarySceneFocused
    && activeAuxiliaryHost?.sceneFocusReturnPresentation === 'docked';
  const activeSession = useActiveSession();
  const [auxPaneReleasedSessionId, setAuxPaneReleasedSessionId] = useState<string | null>(null);
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
  const isSessionSurfaceLoading = !auxPaneReleased;
  const goalSnapshot = useSessionGoalSnapshot(surfaceSessionId);
  // Once the goal is completed the session returns to its normal look: drop the
  // focus frame. The banner stays (neutral) so the result is still visible/clearable.
  const hasGoalMode = goalSnapshot.phase !== 'none' && goalSnapshot.phase !== 'completed';
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const auxiliaryConfig = AUXILIARY_SURFACE_CONFIG;

  const containerRef = useRef<HTMLDivElement>(null);
  const chatPaneRef = useRef<HTMLDivElement>(null);
  const resizerRef = useRef<HTMLDivElement>(null);
  const auxPaneElementRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const auxiliaryDisplayMode: PanelDisplayMode = useMemo(() => {
    if (auxiliaryCollapsed) return 'collapsed';
    return getPanelDisplayMode(currentRightWidth, auxiliaryConfig);
  }, [auxiliaryCollapsed, currentRightWidth, auxiliaryConfig]);

  const calculateValidRightWidth = useCallback((newWidth: number): number => {
    if (!containerRef.current) return newWidth;
    const containerWidth = containerRef.current.offsetWidth;
    if (containerWidth <= 0) return newWidth;
    const reserved = PANEL_COMMON_CONFIG.RESIZER_WIDTH + PANEL_COMMON_CONFIG.MIN_CENTER_WIDTH;
    const dynamicMax = containerWidth - reserved;
    const maxWidth =
      dynamicMax < auxiliaryConfig.COMPACT_WIDTH
        ? auxiliaryConfig.MAX_WIDTH
        : Math.min(auxiliaryConfig.MAX_WIDTH, dynamicMax);
    return Math.min(maxWidth, Math.max(auxiliaryConfig.COMPACT_WIDTH, newWidth));
  }, [auxiliaryConfig]);

  const saveAndUpdateRightWidth = useCallback((width: number) => {
    updateAuxiliaryWidth(width);
  }, [updateAuxiliaryWidth]);

  const handleDoubleClick = useCallback(() => {
    const nextMode = getNextMode(auxiliaryDisplayMode);
    const targetWidth = getModeWidth(nextMode, auxiliaryConfig);
    saveAndUpdateRightWidth(calculateValidRightWidth(targetWidth));
  }, [auxiliaryDisplayMode, auxiliaryConfig, calculateValidRightWidth, saveAndUpdateRightWidth]);

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
        if (auxPaneElementRef.current) {
          auxPaneElementRef.current.style.width = `${valid}px`;
        } else {
          updateAuxiliaryWidth(valid);
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

      const snapped = getSnappedWidth(lastValidWidth, auxiliaryConfig, false);
      if (snapped !== lastValidWidth) {
        saveAndUpdateRightWidth(snapped);
      } else {
        updateAuxiliaryWidth(lastValidWidth);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => setIsDragging(false)));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [
    currentRightWidth,
    calculateValidRightWidth,
    updateAuxiliaryWidth,
    saveAndUpdateRightWidth,
    auxiliaryConfig,
  ]);

  // Responsive resize �?also validate on mount to clamp widths restored from localStorage.
  useEffect(() => {
    const validate = () => {
      const valid = calculateValidRightWidth(currentRightWidth);
      if (valid !== currentRightWidth) updateAuxiliaryWidth(valid);
    };
    const rafId = requestAnimationFrame(validate);
    window.addEventListener('resize', validate);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', validate);
    };
  }, [currentRightWidth, calculateValidRightWidth, updateAuxiliaryWidth]);

  // Cleanup animation frames
  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
  }, []);

  useEffect(() => {
    if (!auxiliarySceneFocused) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      exitActiveAuxiliarySceneFocus('previous');
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [auxiliarySceneFocused]);

  useEffect(() => {
    const chatPane = chatPaneRef.current;
    if (!chatPane) return;
    if (auxiliarySceneFocused) chatPane.setAttribute('inert', '');
    else chatPane.removeAttribute('inert');
  }, [auxiliarySceneFocused]);

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
        auxiliarySceneFocused && 'sparo-session-scene--auxiliary-focus',
        isEntering && 'layout-entering',
      ].filter(Boolean).join(' ')}
      data-agent={profile.theme.dataAgent}
      data-testid="session-scene"
      data-goal-phase={goalSnapshot.phase}
      style={rootStyle}
    >
      {/* ChatPane �?FlowChat conversation */}
      <div
        ref={chatPaneRef}
        className={`sparo-session-scene__chat-pane ${isDragging ? 'sparo-session-scene__chat-pane--dragging' : ''}`}
        aria-hidden={auxiliarySceneFocused || undefined}
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

      {auxiliarySceneFocused ? (
        <div
          className="sparo-session-scene__scene-focus-layout-placeholder"
          style={{ width: preserveDockedLayoutDuringSceneFocus ? `${currentRightWidth}px` : 0 }}
          aria-hidden="true"
        />
      ) : null}

      {/* Resizer �?always rendered (when chat visible) for slide animation */}
      <div
        ref={resizerRef}
        className={[
            'sparo-pane-resizer',
            auxiliaryCollapsed && 'sparo-pane-resizer--collapsed',
            isDragging && 'sparo-pane-resizer--dragging',
            isHovering && 'sparo-pane-resizer--hovering',
            auxiliarySceneFocused && 'sparo-pane-resizer--scene-focus',
        ].filter(Boolean).join(' ')}
        onMouseDown={handleMouseDownResizer}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        tabIndex={auxiliaryCollapsed || auxiliarySceneFocused ? -1 : 0}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('layout.resizer.rightAriaLabel')}
        aria-valuenow={currentRightWidth}
        aria-valuemin={auxiliaryConfig.COMPACT_WIDTH}
        aria-valuemax={auxiliaryConfig.MAX_WIDTH}
        title={t('layout.resizer.title', { mode: panelModeLabels[auxiliaryDisplayMode] })}
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

      {/* AuxPane �?ContentCanvas */}
      <div
        id="session-auxiliary-surface"
        ref={auxPaneElementRef}
        className={[
          'sparo-session-scene__aux-pane',
          auxiliaryCollapsed                       && 'sparo-session-scene__aux-pane--collapsed',
          isDragging                               && 'sparo-session-scene__aux-pane--dragging',
          auxiliarySceneFocused                    && 'sparo-session-scene__aux-pane--scene-focus',
        ].filter(Boolean).join(' ')}
        style={{
          width: auxiliaryCollapsed || auxiliarySceneFocused
            ? undefined
            : `${currentRightWidth}px`,
        }}
        data-mode={auxiliaryDisplayMode}
        aria-hidden={auxiliaryCollapsed}
      >
        {auxiliarySceneFocused ? (
          <header
            className="sparo-session-scene__scene-focus-header"
            data-testid="scene-focus-header"
          >
            <IconButton
              aria-label={t('layout.sceneFocus.backToChat')}
              tooltip={t('layout.sceneFocus.backToChat')}
              tooltipPlacement="bottom"
              tooltipFollowCursor={false}
              size="small"
              variant="ghost"
              onClick={() => exitActiveAuxiliarySceneFocus('previous')}
            >
              <ArrowLeft aria-hidden="true" size={16} />
            </IconButton>
            <span
              className="sparo-session-scene__scene-focus-divider"
              aria-hidden="true"
            />
            <span className="sparo-session-scene__scene-focus-title">
              {t('layout.sceneFocus.title')}
            </span>
          </header>
        ) : null}
        <div className="sparo-session-scene__aux-content">
          {auxPaneReleased ? (
            <AuxPane
              workspacePath={workspacePath}
              isSceneActive={isActive}
              isSceneFocused={auxiliarySceneFocused}
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
    </div>
  );
};

export default SessionScene;
