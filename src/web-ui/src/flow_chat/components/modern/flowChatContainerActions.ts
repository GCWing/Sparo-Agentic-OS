export interface FlowChatTaskCanceller {
  cancelCurrentTask(): Promise<boolean>;
  cancelTaskForSession(sessionId: string): Promise<boolean>;
}

export function getStopGenerationShortcutId(
  presentation: 'default' | 'embedded',
  sessionId?: string | null,
): string {
  if (presentation === 'embedded' && sessionId) {
    return `chat.stopGeneration.embedded.${sessionId}`;
  }
  return 'chat.stopGeneration';
}

export function cancelFlowChatTask(
  manager: FlowChatTaskCanceller,
  sessionId?: string | null,
): Promise<boolean> {
  return sessionId
    ? manager.cancelTaskForSession(sessionId)
    : manager.cancelCurrentTask();
}
