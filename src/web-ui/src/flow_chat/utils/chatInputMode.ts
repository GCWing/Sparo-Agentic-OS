export function resolveWorkspaceChatInputMode(params: {
  currentAgent: string;
  isAssistantWorkspace: boolean;
  sessionMode?: string | null;
}): string | null {
  const normalizedSessionMode = params.sessionMode?.trim();

  if (normalizedSessionMode && normalizedSessionMode !== params.currentAgent) {
    return normalizedSessionMode;
  }

  return null;
}
