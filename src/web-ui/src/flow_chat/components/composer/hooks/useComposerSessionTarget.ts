import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { useAgentCanvasStore } from '@/app/components/panels/content-canvas/stores';
import { useActiveSessionState } from '../../../hooks/useActiveSessionState';
import {
  selectActiveSideThreadSessionTab,
} from '../../../services/childSessionPanels';
import { resolveSessionRelationship } from '../../../utils/sessionMetadata';
import type { ChatInputTarget } from '../model/composerState';
import { useFlowChatStoreSelector } from '../../../hooks/useFlowChatStoreSelector';

interface UseComposerSessionTargetParams {
  inputTarget: ChatInputTarget;
  setInputTarget: Dispatch<SetStateAction<ChatInputTarget>>;
  t: TFunction<'flow-chat'>;
}

export function useComposerSessionTarget({
  inputTarget,
  setInputTarget,
  t,
}: UseComposerSessionTargetParams) {
  const activeSessionState = useActiveSessionState();
  const activeBtwSessionTab = useAgentCanvasStore(
    state => selectActiveSideThreadSessionTab(state)
  );

  const currentSessionId = activeSessionState.sessionId;
  const activeBtwSessionData = activeBtwSessionTab?.content.data as
    | { childSessionId: string; parentSessionId: string; workspacePath?: string }
    | undefined;
  const activeBtwSessionId = activeBtwSessionData?.parentSessionId === currentSessionId
    ? activeBtwSessionData.childSessionId
    : undefined;

  const effectiveTargetSessionId =
    inputTarget === 'btw' && activeBtwSessionId ? activeBtwSessionId : currentSessionId;
  const showTargetSwitcher = !!activeBtwSessionId;
  const sessionSelection = useFlowChatStoreSelector((state) => {
    const currentSession = currentSessionId ? state.sessions.get(currentSessionId) : undefined;
    const effectiveTargetSession = effectiveTargetSessionId
      ? state.sessions.get(effectiveTargetSessionId)
      : undefined;
    const activeBtwSession = activeBtwSessionId ? state.sessions.get(activeBtwSessionId) : undefined;

    return {
      activeBtwSessionTitle: activeBtwSession?.title?.trim() || '',
      activeSessionDescriptor: effectiveTargetSession?.descriptor,
      currentSession,
      currentSessionModelId: currentSession?.config.modelName?.trim() || 'primary',
      currentSessionTitle: currentSession?.title?.trim() || '',
      effectiveTargetSession,
      isBtwSession: resolveSessionRelationship(effectiveTargetSession).isBtw,
    };
  }, (left, right) =>
    left.activeBtwSessionTitle === right.activeBtwSessionTitle &&
    left.activeSessionDescriptor === right.activeSessionDescriptor &&
    left.currentSession === right.currentSession &&
    left.currentSessionModelId === right.currentSessionModelId &&
    left.currentSessionTitle === right.currentSessionTitle &&
    left.effectiveTargetSession === right.effectiveTargetSession &&
    left.isBtwSession === right.isBtwSession
  );

  useEffect(() => {
    if (!showTargetSwitcher || !activeBtwSessionId) {
      setInputTarget('main');
    }
  }, [activeBtwSessionId, setInputTarget, showTargetSwitcher]);

  return {
    activeBtwSessionId,
    activeBtwSessionTitle: activeBtwSessionId
      ? sessionSelection.activeBtwSessionTitle || t('btw.threadLabel')
      : '',
    activeSessionDescriptor: sessionSelection.activeSessionDescriptor,
    currentSession: sessionSelection.currentSession,
    currentSessionId,
    currentSessionModelId: sessionSelection.currentSessionModelId,
    currentSessionTitle: sessionSelection.currentSessionTitle || t('session.untitled'),
    effectiveTargetSession: sessionSelection.effectiveTargetSession,
    effectiveTargetSessionId,
    isBtwSession: sessionSelection.isBtwSession,
    showTargetSwitcher,
  };
}
