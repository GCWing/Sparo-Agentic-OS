/**
 * Workspace navigation — public API backed by navigationController.
 *
 * All session/scene switching should go through this module or navigationController
 * so surface state, focus, and hydration stay in sync.
 */

import type { WorkspaceSceneId } from './workspaceSceneTypes';
import {
  getActiveWorkspaceSurface,
  goBackScene as goBackSceneController,
  openHome,
  openScene as openSceneController,
  openSceneHistoryEntry as openSceneHistoryEntryController,
  openSession as openSessionController,
  type OpenWorkspaceSceneOptions,
  type OpenWorkspaceSessionOptions,
} from './navigationController';

export type { OpenWorkspaceSceneOptions, OpenWorkspaceSessionOptions };

export function openWorkspaceScene(
  sceneId: WorkspaceSceneId,
  options: OpenWorkspaceSceneOptions = {}
): void {
  openSceneController(sceneId, options);
}

export function goBackWorkspaceScene(): boolean {
  return goBackSceneController();
}

export function openWorkspaceSceneHistoryEntry(index: number): boolean {
  return openSceneHistoryEntryController(index);
}

export async function openWorkspaceSession(
  sessionId: string,
  options: OpenWorkspaceSessionOptions = {}
): Promise<void> {
  await openSessionController(sessionId, options);
}

export async function openWorkspaceHome(): Promise<string | null> {
  return openHome();
}

export { getActiveWorkspaceSurface };
