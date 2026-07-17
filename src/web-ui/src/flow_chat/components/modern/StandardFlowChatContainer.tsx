/**
 * Standard FlowChat container — for regular (non-Agentic OS) sessions.
 *
 * Handles: in-message search, single-session turn list sidebar, standard
 * keyboard shortcuts. Evolves independently from AgenticOSFlowChatContainer.
 */

import React, { useMemo } from 'react';
import { useShortcut } from '@/infrastructure/hooks/useShortcut';
import { FlowChatManager } from '@/flow_chat/services/FlowChatManager';
import { useSessionModeStore } from '@/app/stores/sessionModeStore';
import { VirtualMessageList } from './VirtualMessageList';
import { FlowChatHeader } from './FlowChatHeader';
import { FlowChatSelectionAddButton } from './FlowChatSelectionAddButton';
import { WelcomePanel } from '../WelcomePanel';
import { FallbackWelcomePanel } from '../FallbackWelcomePanel';
import {
  SessionTranscriptError,
  SessionTranscriptLoading,
  shouldShowSessionTranscriptError,
  shouldShowSessionTranscriptLoading,
} from './SessionTranscriptLoading';
import {
  FlowChatContext,
  FlowChatStaticContext,
  FlowChatViewContext,
  type FlowChatContextValue,
} from './FlowChatContext';
import { useFlowChatCore, type UseFlowChatCoreOptions } from './useFlowChatCore';
import { useSessionSidecarActions } from './useSessionSidecarActions';
import { getDefaultSessionDescriptor } from '../../domain/sessionDescriptor';
import { useSessionProfile } from '@/app/session-profiles';
import type { FlowChatPresentation } from './ModernFlowChatContainer';
import { cancelFlowChatTask, getStopGenerationShortcutId } from './flowChatContainerActions';
import './ModernFlowChatContainer.scss';

type StandardFlowChatContainerProps = UseFlowChatCoreOptions & {
  className?: string;
  active?: boolean;
  presentation?: FlowChatPresentation;
};

export const StandardFlowChatContainer: React.FC<StandardFlowChatContainerProps> = ({
  className = '',
  sessionId,
  active = true,
  presentation = 'default',
  mutationsDisabled = false,
  workspacePath,
  config,
  onFileViewRequest,
  onTabOpen,
  onOpenVisualization,
  onSwitchToChatPanel,
}) => {
  const core = useFlowChatCore({
    initialTimelineOpen: false,
    sessionId,
    workspacePath,
    config,
    mutationsDisabled,
    onFileViewRequest,
    onTabOpen,
    onOpenVisualization,
    onSwitchToChatPanel,
  });

  const {
    session: scopedSession,
    virtualItems,
    activeSession,
    virtualListRef,
    chatScopeRef,
    searchMatches,
    searchCurrentMatchIndex,
    handleSearchNext,
    handleSearchPrev,
    clearSearch,
    searchOpenRequest,
    setSearchOpenRequest,
    staticContextValue,
    viewContextValue,
    searchQuery,
    onSearchChange,
    workspacePath: effectiveWorkspacePath,
  } = core;

  const contextValue: FlowChatContextValue = useMemo(
    () => ({ ...staticContextValue, ...viewContextValue }),
    [staticContextValue, viewContextValue],
  );
  const sidecarActions = useSessionSidecarActions();
  const { profile } = useSessionProfile();
  const embedded = presentation === 'embedded';
  const transcriptLoading = shouldShowSessionTranscriptLoading(sessionId, activeSession);
  const transcriptError = shouldShowSessionTranscriptError(sessionId, activeSession);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useShortcut(
    getStopGenerationShortcutId(presentation, sessionId),
    { key: 'Escape', scope: 'chat', allowInInput: true },
    () => {
      void cancelFlowChatTask(FlowChatManager.getInstance(), sessionId);
    },
    {
      priority: 20,
      description: 'keyboard.shortcuts.chat.stopGeneration',
      enabled: active,
    },
  );

  useShortcut(
    'chat.newSession',
    { key: 'N', ctrl: true, scope: 'chat' },
    () => {
      void (async () => {
        try {
          useSessionModeStore.getState().setMode('runno');
          await FlowChatManager.getInstance().createChatSession(
            { workspacePath: effectiveWorkspacePath || undefined },
            getDefaultSessionDescriptor()
          );
        } catch { /* ignore */ }
      })();
    },
    {
      priority: 10,
      description: 'keyboard.shortcuts.chat.newSession',
      enabled: active && !embedded,
    },
  );

  useShortcut(
    'btw-fill',
    { key: 'B', ctrl: true, alt: true, scope: 'chat', allowInInput: true },
    () => {
      const selected = (window.getSelection?.()?.toString() ?? '').trim();
      const message = selected ? `/btw Explain this:\n\n${selected}` : '/btw ';
      window.dispatchEvent(new CustomEvent('fill-chat-input', { detail: { message } }));
    },
    {
      priority: 20,
      description: 'keyboard.shortcuts.chat.btwFill',
      enabled: active && !embedded,
    },
  );

  useShortcut(
    'chat.search',
    { key: 'F', ctrl: true, scope: 'chat', allowInInput: false },
    () => {
      setSearchOpenRequest(prev => prev + 1);
    },
    {
      priority: 15,
      description: 'keyboard.shortcuts.chat.search',
      enabled: active && !embedded,
    },
  );

  return (
    <FlowChatContext.Provider value={contextValue}>
      <FlowChatStaticContext.Provider value={staticContextValue}>
        <FlowChatViewContext.Provider value={viewContextValue}>
          <div
            ref={chatScopeRef}
            className={['modern-flowchat-container', 'flow-chat-typography', className]
              .filter(Boolean)
              .join(' ')}
            data-shortcut-scope="chat"
            data-presentation={presentation}
          >
            {!embedded ? <FlowChatSelectionAddButton containerRef={chatScopeRef} /> : null}

            {!embedded ? (
              <FlowChatHeader
                visible={!!activeSession}
                sessionId={activeSession?.sessionId}
                workspacePath={activeSession?.workspacePath ?? effectiveWorkspacePath ?? undefined}
                searchQuery={searchQuery}
                onSearchChange={onSearchChange}
                searchMatchCount={searchMatches.length}
                searchCurrentMatch={searchMatches.length > 0 ? searchCurrentMatchIndex + 1 : 0}
                onSearchNext={handleSearchNext}
                onSearchPrev={handleSearchPrev}
                onSearchClose={clearSearch}
                searchOpenRequest={searchOpenRequest}
                showTimelineControl={false}
                sidecarActions={sidecarActions}
              />
            ) : null}

            <div className="modern-flowchat-container__body">
              <div className="modern-flowchat-container__messages">
                <div className="modern-flowchat-container__messages-inner">
                  {transcriptLoading ? (
                    <SessionTranscriptLoading />
                  ) : transcriptError && activeSession?.sessionId ? (
                    <SessionTranscriptError
                      sessionId={activeSession.sessionId}
                    />
                  ) : virtualItems.length === 0 ? (
                    profile.capabilities.showWelcomePanel ? (
                      <WelcomePanel
                        key={activeSession?.sessionId ?? 'welcome'}
                        sessionId={activeSession?.sessionId}
                        workspacePath={activeSession?.workspacePath}
                        preferredDescriptor={activeSession?.descriptor}
                        onQuickAction={command => {
                          window.dispatchEvent(
                            new CustomEvent('fill-chat-input', {
                              detail: {
                                message: command,
                                sessionId: activeSession?.sessionId,
                              },
                            }),
                          );
                        }}
                      />
                    ) : (
                      <FallbackWelcomePanel />
                    )
                  ) : (
                    <VirtualMessageList
                      key={activeSession?.sessionId ?? 'virtual-message-list'}
                      ref={virtualListRef}
                      session={scopedSession}
                      virtualItems={virtualItems}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </FlowChatViewContext.Provider>
      </FlowChatStaticContext.Provider>
    </FlowChatContext.Provider>
  );
};

StandardFlowChatContainer.displayName = 'StandardFlowChatContainer';
