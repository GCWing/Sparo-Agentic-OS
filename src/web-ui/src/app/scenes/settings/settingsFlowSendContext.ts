import type { MessageSendContext } from '@/flow_chat/hooks/useMessageSender';

export function createSettingsFlowSendContext(
  expectedRevision: number,
  dirtySettingIds: readonly string[],
): MessageSendContext {
  return {
    metadata: {
      settingsContext: {
        expectedRevision,
        dirtySettingIds: [...dirtySettingIds].sort(),
      },
    },
  };
}
