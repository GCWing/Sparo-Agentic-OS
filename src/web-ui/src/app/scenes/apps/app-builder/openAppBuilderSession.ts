import { findReusableEmptyAppBuilderSessionId } from '@/app/utils/projectSessionWorkspace';
import { SESSION_DESCRIPTORS } from '@/flow_chat/domain/sessionDescriptor';
import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';

export async function openAppBuilderSession(): Promise<string> {
  const reusableSessionId = findReusableEmptyAppBuilderSessionId();
  if (reusableSessionId) {
    await openMainSession(reusableSessionId);
    return reusableSessionId;
  }

  const sessionId = await flowChatManager.createChatSession(
    {
      storageScope: 'agentic_os',
      creationDeduplicationKey: 'native-app-builder-session',
    },
    SESSION_DESCRIPTORS.appBuilder,
  );
  await openMainSession(sessionId);
  return sessionId;
}
