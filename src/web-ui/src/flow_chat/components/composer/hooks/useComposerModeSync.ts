import { useEffect } from 'react';
import type { Dispatch } from 'react';
import { globalEventBus } from '@/infrastructure/event-bus';
import { createLogger } from '@/shared/utils/logger';
import type { ModeAction } from '../../../reducers/modeReducer';
import { resolveWorkspaceChatInputMode } from '../../../utils/chatInputMode';

const log = createLogger('ComposerModeSync');

interface UseComposerModeSyncParams {
  activeSessionMode?: string;
  currentMode: string;
  dispatchMode: Dispatch<ModeAction>;
  effectiveTargetSessionId?: string | null;
}

function persistLastMode(mode: string) {
  try {
    sessionStorage.setItem('sparo:flowchat:lastMode', mode);
  } catch {
    // ignore
  }
}

export function useComposerModeSync({
  activeSessionMode,
  currentMode,
  dispatchMode,
  effectiveTargetSessionId,
}: UseComposerModeSyncParams) {
  useEffect(() => {
    const fetchAvailableModes = async () => {
      try {
        const { agentAPI } = await import('@/infrastructure/api/service-api/AgentAPI');
        const modes = await agentAPI.getAvailableModes();
        dispatchMode({ type: 'SET_AVAILABLE_MODES', payload: modes });
      } catch (error) {
        log.error('Failed to fetch available modes', { error });
      }
    };

    fetchAvailableModes();

    const handleModeConfigUpdated = () => {
      fetchAvailableModes();
    };

    globalEventBus.on('mode:config:updated', handleModeConfigUpdated);

    return () => {
      globalEventBus.off('mode:config:updated', handleModeConfigUpdated);
    };
  }, [dispatchMode]);

  useEffect(() => {
    const handleSessionSwitched = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId: string; mode: string }>;
      const { sessionId, mode } = customEvent.detail || {};

      if (sessionId && mode) {
        log.debug('Session switched, syncing mode', { sessionId, mode });
        dispatchMode({ type: 'SET_CURRENT_MODE', payload: mode });
        persistLastMode(mode);
      }
    };

    window.addEventListener('sparo:session-switched', handleSessionSwitched);

    return () => {
      window.removeEventListener('sparo:session-switched', handleSessionSwitched);
    };
  }, [dispatchMode]);

  useEffect(() => {
    const nextMode = resolveWorkspaceChatInputMode({
      currentMode,
      isAssistantWorkspace: false,
      sessionMode: activeSessionMode,
    });

    if (nextMode) {
      log.debug('Syncing mode with workspace and session', {
        sessionId: effectiveTargetSessionId,
        mode: nextMode,
        sessionMode: activeSessionMode,
      });
      dispatchMode({ type: 'SET_CURRENT_MODE', payload: nextMode });
      persistLastMode(nextMode);
    }
  }, [activeSessionMode, currentMode, dispatchMode, effectiveTargetSessionId]);
}
