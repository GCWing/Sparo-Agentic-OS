/**
 * Helper utilities for workspace operations in e2e tests.
 */

import { browser, $, $$ } from '@wdio/globals';
import * as path from 'path';

export interface WorkspaceState {
  currentWorkspacePath: string | null;
  openedWorkspacePaths: string[];
  workspaceLabels: string[];
}

/**
 * Open a workspace through the frontend state layer so the UI stays in sync.
 */
export async function openWorkspaceThroughFrontend(workspacePath: string): Promise<void> {
  await browser.execute(async (targetWorkspacePath: string) => {
    const { workspaceManager } = await import('/src/infrastructure/services/business/workspaceManager.ts');
    await workspaceManager.openWorkspace(targetWorkspacePath);
  }, workspacePath);
}

/**
 * Read the current frontend-visible workspace state.
 */
export async function getWorkspaceState(): Promise<WorkspaceState> {
  return browser.execute(async () => {
    const { workspaceManager } = await import('/src/infrastructure/services/business/workspaceManager.ts');
    const managerState = workspaceManager.getState();
    const openedWorkspaces = Array.from(managerState.openedWorkspaces.values());
    const workspaceLabels = Array.from(document.querySelectorAll('.bitfun-nav-panel__workspace-item-label'))
      .map(element => element.textContent?.trim() || '')
      .filter(Boolean);

    return {
      currentWorkspacePath: managerState.lastUsedWorkspace?.rootPath || null,
      openedWorkspacePaths: openedWorkspaces.map(workspace => workspace.rootPath),
      workspaceLabels,
    };
  });
}

/**
 * Wait until both frontend state and nav DOM reflect the target workspace.
 */
export async function waitForWorkspaceReady(
  workspacePath: string,
  projectName: string = path.basename(workspacePath),
  timeout: number = 15000,
): Promise<WorkspaceState> {
  await browser.waitUntil(async () => {
    const state = await getWorkspaceState();
    return state.currentWorkspacePath === workspacePath
      && state.openedWorkspacePaths.includes(workspacePath);
  }, {
    timeout,
    interval: 500,
    timeoutMsg: `Workspace did not become active in frontend state: ${workspacePath}`,
  });

  return getWorkspaceState();
}

/**
 * Open a workspace and wait until the frontend is ready to interact with it.
 */
export async function openWorkspace(
  workspacePath: string = process.env.E2E_TEST_WORKSPACE || process.cwd(),
): Promise<boolean> {
  try {
    await openWorkspaceThroughFrontend(workspacePath);
    await waitForWorkspaceReady(workspacePath);
    return true;
  } catch (error) {
    console.error('[WorkspaceHelper] Failed to open workspace through frontend state:', error);
    return false;
  }
}

interface CodeSessionFocusState {
  ok: boolean;
  sessionId: string | null;
  targetSessionId: string | null;
  createdDescriptor?: unknown;
  targetDescriptor?: unknown;
  surfaces?: unknown;
  codingSessions: Array<{
    sessionId: string;
    workspacePath?: string;
    policy: unknown;
  }>;
}

async function focusCodeSessionThroughFrontend(workspacePath: string): Promise<CodeSessionFocusState> {
  return browser.execute(async (targetWorkspacePath: string) => {
    const { workspaceManager } = await import('/src/infrastructure/services/business/workspaceManager.ts');
    const { flowChatManager } = await import('/src/flow_chat/services/FlowChatManager.ts');
    const { flowChatStore } = await import('/src/flow_chat/store/FlowChatStore.ts');
    const {
      getDefaultSessionDescriptor,
      normalizeSessionDescriptor,
    } = await import('/src/flow_chat/domain/sessionDescriptor.ts');
    const { useWorkspaceSurfaceStore } = await import('/src/app/navigation/workspaceSurfaceStore.ts');
    const managerStore = ((flowChatManager as any).context?.flowChatStore ?? flowChatStore) as typeof flowChatStore;

    const workspace = workspaceManager.getState().lastUsedWorkspace;
    const targetPath = workspace?.rootPath?.trim() || targetWorkspacePath;
    const normalizePath = (value?: string | null) => (value ?? '').trim().replace(/\\/g, '/').toLowerCase();
    const workspaceKey = normalizePath(targetPath);
    const codingSessions = Array.from(managerStore.getState().sessions.values())
      .filter(session => (
        session.descriptor.profileId === 'coding' &&
        normalizePath(session.workspacePath) === workspaceKey
      ))
      .sort((left, right) => (
        (right.lastActiveAt ?? right.createdAt ?? 0) - (left.lastActiveAt ?? left.createdAt ?? 0)
      ));

    const sessionId = codingSessions[0]?.sessionId ?? await flowChatManager.createChatSession({
      workspaceId: workspace?.id,
      workspacePath: targetPath,
    }, getDefaultSessionDescriptor());

    const session = managerStore.getState().sessions.get(sessionId);
    if (session) {
      managerStore.reconcileSessionDescriptor(
        sessionId,
        normalizeSessionDescriptor(session.descriptor),
        session.workspacePath || targetPath,
        session.storageScope,
      );
    }

    await flowChatManager.switchChatSession(sessionId);
    useWorkspaceSurfaceStore.getState().openSurface({ kind: 'session', sessionId });

    const surfaceState = useWorkspaceSurfaceStore.getState();
    const targetSessionId = surfaceState.composerTargetSessionId || surfaceState.focusedSessionId;
    const targetSession = targetSessionId ? managerStore.getState().sessions.get(targetSessionId) : null;
    const ok = Boolean(
      targetSessionId === sessionId &&
      targetSession?.descriptor.profileId === 'coding' &&
      targetSession.descriptor.agentPolicy.switchableAgentIds.includes('Plan')
    );
    return {
      ok,
      sessionId,
      targetSessionId,
      createdDescriptor: managerStore.getState().sessions.get(sessionId)?.descriptor,
      targetDescriptor: targetSession?.descriptor,
      surfaces: {
        activeSurface: surfaceState.activeSurface,
        focusedSessionId: surfaceState.focusedSessionId,
        composerTargetSessionId: surfaceState.composerTargetSessionId,
      },
      codingSessions: Array.from(managerStore.getState().sessions.values())
        .filter(session => session.descriptor.profileId === 'coding')
        .slice(-5)
        .map(session => ({
          sessionId: session.sessionId,
          workspacePath: session.workspacePath,
          policy: session.descriptor.agentPolicy,
        })),
    };
  }, workspacePath);
}

/**
 * Ensure a Code session is open for the active workspace.
 */
export async function ensureCodeSessionOpen(
  workspacePath: string = process.env.E2E_TEST_WORKSPACE || process.cwd(),
): Promise<void> {
  await openWorkspaceThroughFrontend(workspacePath);
  await waitForWorkspaceReady(workspacePath);

  await browser.waitUntil(async () => {
    const focusState = await focusCodeSessionThroughFrontend(workspacePath);
    if (!focusState.ok) {
      console.log('[WorkspaceHelper] Code session focus state:', JSON.stringify(focusState));
    }
    const input = await $('[data-testid="chat-input-container"]');
    return (await input.isExisting()) && focusState.ok;
  }, {
    timeout: 15000,
    interval: 500,
    timeoutMsg: 'Code session did not open',
  });
}

/**
 * Checks if any workspace is currently active in the frontend.
 */
export async function isWorkspaceOpen(): Promise<boolean> {
  const state = await getWorkspaceState();
  if (state.currentWorkspacePath) {
    return true;
  }

  const chatInput = await $('[data-testid="chat-input-container"]');
  return await chatInput.isExisting();
}

export default {
  openWorkspaceThroughFrontend,
  getWorkspaceState,
  waitForWorkspaceReady,
  openWorkspace,
  ensureCodeSessionOpen,
  isWorkspaceOpen,
};
