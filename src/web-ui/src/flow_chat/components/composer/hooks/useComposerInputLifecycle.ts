import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useChatInputState } from '../../../store/chatInputStateStore';

export function useComposerInputLifecycle({
  effectiveTargetSessionId,
  isActive,
  isExpanded,
  setHistoryIndex,
}: {
  effectiveTargetSessionId?: string | null;
  isActive: boolean;
  isExpanded: boolean;
  setHistoryIndex: Dispatch<SetStateAction<number>>;
}) {
  const setChatInputActive = useChatInputState(state => state.setActive);
  const setChatInputExpanded = useChatInputState(state => state.setExpanded);

  useEffect(() => {
    setChatInputActive(isActive);
  }, [isActive, setChatInputActive]);

  useEffect(() => {
    setChatInputExpanded(isExpanded);
  }, [isExpanded, setChatInputExpanded]);

  useEffect(() => {
    setHistoryIndex(-1);
  }, [effectiveTargetSessionId, setHistoryIndex]);
}
