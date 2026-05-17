import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { useAgentCanvasStore } from '@/app/components/panels/content-canvas/stores';
import { useActiveSessionState } from '../../../hooks/useActiveSessionState';
import type { FlowChatState } from '../../../types/flow-chat';
import {
  selectActiveSideThreadSessionTab,
} from '../../../services/childSessionPanels';
import { resolveSessionRelationship } from '../../../utils/sessionMetadata';
import type { ChatInputTarget } from '../model/composerState';

interface UseComposerSessionTargetParams {
  flowChatState: FlowChatState;
  inputTarget: ChatInputTarget;
  setInputTarget: Dispatch<SetStateAction<ChatInputTarget>>;
  t: TFunction<'flow-chat'>;
}

export function useComposerSessionTarget({
  flowChatState,
  inputTarget,
  setInputTarget,
  t,
}: UseComposerSessionTargetParams) {
  const activeSessionState = useActiveSessionState();
  const activeBtwSessionTab = useAgentCanvasStore(
    state => selectActiveSideThreadSessionTab(state)
  );

  const currentSessionId = activeSessionState.sessionId;
  const currentSession = currentSessionId ? flowChatState.sessions.get(currentSessionId) : undefined;
  const currentSessionModelId = currentSession?.config.modelName?.trim() || 'primary';

  const activeBtwSessionData = activeBtwSessionTab?.content.data as
    | { childSessionId: string; parentSessionId: string; workspacePath?: string }
    | undefined;
  const activeBtwSessionId = activeBtwSessionData?.parentSessionId === currentSessionId
    ? activeBtwSessionData.childSessionId
    : undefined;

  const effectiveTargetSessionId =
    inputTarget === 'btw' && activeBtwSessionId ? activeBtwSessionId : currentSessionId;
  const effectiveTargetSession = effectiveTargetSessionId
    ? flowChatState.sessions.get(effectiveTargetSessionId)
    : undefined;
  const isBtwSession = resolveSessionRelationship(effectiveTargetSession).isBtw;
  const showTargetSwitcher = !!activeBtwSessionId;
  const currentSessionTitle = currentSession?.title?.trim() || t('session.untitled');
  const activeBtwSessionTitle = activeBtwSessionId
    ? flowChatState.sessions.get(activeBtwSessionId)?.title?.trim() || t('btw.threadLabel')
    : '';
  const activeSessionMode = effectiveTargetSession?.mode;

  useEffect(() => {
    if (!showTargetSwitcher || !activeBtwSessionId) {
      setInputTarget('main');
    }
  }, [activeBtwSessionId, setInputTarget, showTargetSwitcher]);

  return {
    activeBtwSessionId,
    activeBtwSessionTitle,
    activeSessionMode,
    currentSession,
    currentSessionId,
    currentSessionModelId,
    currentSessionTitle,
    effectiveTargetSession,
    effectiveTargetSessionId,
    isBtwSession,
    showTargetSwitcher,
  };
}
