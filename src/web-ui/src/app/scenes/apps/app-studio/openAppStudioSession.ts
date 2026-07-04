import { findReusableEmptyAppStudioSessionId } from '@/app/utils/projectSessionWorkspace';
import { SESSION_DESCRIPTORS } from '@/flow_chat/domain/sessionDescriptor';
import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';

export async function openAppStudioSession(): Promise<string> {
  const reusableSessionId = findReusableEmptyAppStudioSessionId();
  if (reusableSessionId) {
    await openMainSession(reusableSessionId);
    return reusableSessionId;
  }

  const sessionId = await flowChatManager.createChatSession(
    {
      storageScope: 'agentic_os',
      creationDeduplicationKey: 'native-app-studio-session',
    },
    SESSION_DESCRIPTORS.appStudio,
  );
  await openMainSession(sessionId);
  return sessionId;
}
