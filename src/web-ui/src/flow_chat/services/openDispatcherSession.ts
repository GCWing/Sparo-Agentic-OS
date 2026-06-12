import { openWorkspaceHome } from '@/app/navigation/workspaceNavigation';

/**
 * Focuses the latest Agentic OS (Dispatcher) session, or creates one if missing.
 * Mirrors the nav "Agentic OS" entry behavior.
 */
export async function openDispatcherSession(): Promise<string> {
  return openWorkspaceHome();
}
