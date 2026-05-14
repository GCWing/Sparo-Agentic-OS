import { FlowChatStore } from '@/flow_chat/store/FlowChatStore';
import { useOverlayStore } from '@/app/stores/overlayStore';

export async function openAgentCompanionSession(sessionId: string): Promise<boolean> {
  const flowChatStore = FlowChatStore.getInstance();
  const session = flowChatStore.getState().sessions.get(sessionId);
  if (!session) {
    return false;
  }

  flowChatStore.switchSession(sessionId);
  useOverlayStore.getState().closeOverlay();
  return true;
}
