import { useEffect, useState } from 'react';
import { FlowChatStore } from '../../../store/FlowChatStore';
import type { FlowChatState } from '../../../types/flow-chat';

export function useComposerFlowChatState(): FlowChatState {
  const [flowChatState, setFlowChatState] = useState<FlowChatState>(() =>
    FlowChatStore.getInstance().getState(),
  );

  useEffect(() => FlowChatStore.getInstance().subscribe(setFlowChatState), []);

  return flowChatState;
}
