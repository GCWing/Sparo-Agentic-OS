import { FlowChatStore } from '@/flow_chat/store/FlowChatStore';
import { openWorkspaceSession } from '@/app/navigation/workspaceNavigation';

export async function openAgentCompanionSession(sessionId: string): Promise<boolean> {
  const flowChatStore = FlowChatStore.getInstance();
  const session = flowChatStore.getState().sessions.get(sessionId);
  if (!session) {
    return false;
  }

  await openWorkspaceSession(sessionId);
  return true;
}
