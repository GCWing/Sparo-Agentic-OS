import { useEffect, useState } from 'react';
import { FlowChatStore } from '../../../store/FlowChatStore';
import type { FlowChatState } from '../../../types/flow-chat';

export function useComposerTokenUsage(effectiveTargetSessionId?: string | null) {
  const [tokenUsage, setTokenUsage] = useState({ current: 0, max: 128128 });

  useEffect(() => {
    const store = FlowChatStore.getInstance();

    const updateFromState = (state: FlowChatState) => {
      if (effectiveTargetSessionId) {
        const session = state.sessions.get(effectiveTargetSessionId);
        if (session) {
          setTokenUsage({
            current: session.currentTokenUsage?.totalTokens || 0,
            max: session.maxContextTokens || 128128,
          });
        }
      }
    };

    const unsubscribe = store.subscribe(updateFromState);
    updateFromState(store.getState());

    return () => unsubscribe();
  }, [effectiveTargetSessionId]);

  return tokenUsage;
}
