import { openWorkspaceHome } from '@/app/navigation/workspaceNavigation';

/**
 * Focuses the latest Agentic OS session, or creates one if missing.
 * Mirrors the nav "Agentic OS" entry behavior.
 */
export async function openAgenticOsSession(): Promise<string> {
  return openWorkspaceHome();
}
