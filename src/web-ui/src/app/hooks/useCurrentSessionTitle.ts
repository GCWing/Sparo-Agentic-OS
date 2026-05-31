/**
 * useCurrentSessionTitle — returns the active FlowChat session title.
 * Subscribes to flowChatStore so the value updates reactively.
 */

import { useState, useEffect } from 'react';
import { flowChatStore } from '../../flow_chat/store/FlowChatStore';

export function useCurrentSessionTitle(): string {
  const [title, setTitle] = useState<string>(() => {
    const s = flowChatStore.getState();
    const session = s.activeSessionId ? s.sessions.get(s.activeSessionId) : undefined;
    return session?.title ?? '';
  });

  useEffect(() => {
    const unsubscribe = flowChatStore.subscribeSelector(
      state => {
        const session = state.activeSessionId ? state.sessions.get(state.activeSessionId) : undefined;
        return session?.title ?? '';
      },
      nextTitle => setTitle(nextTitle),
    );
    return unsubscribe;
  }, []);

  return title;
}
