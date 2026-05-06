 

import {
  WorkspaceInfo,
  WorkspaceKind,
  globalStateAPI,
  isRemoteWorkspace,
} from '../../../shared/types';
import { normalizeRemoteWorkspacePath } from '@/shared/utils/pathUtils';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('WorkspaceManager');

export type WorkspaceEvent =
  | { type: 'workspace:opened'; workspace: WorkspaceInfo }
  | { type: 'workspace:closed'; workspaceId: string }
  | { type: 'workspace:removed'; workspaceId: string }
  | { type: 'workspace:remembered'; workspace: WorkspaceInfo }
  | { type: 'workspace:last-used-changed'; workspace: WorkspaceInfo | null }
  | { type: 'workspace:updated'; workspace: WorkspaceInfo }
  | { type: 'workspace:recent-updated' }
  | { type: 'workspace:loading'; loading: boolean }
  | { type: 'workspace:error'; error: string | null };

export type WorkspaceEventListener = (event: WorkspaceEvent) => void;

export interface WorkspaceState {
  lastUsedWorkspace: WorkspaceInfo | null;
  openedWorkspaces: Map<string, WorkspaceInfo>;
  lastUsedWorkspaceId: string | null;
  recentWorkspaces: WorkspaceInfo[];
  loading: boolean;
  error: string | null;
}

export type WorkspaceSection = 'projects';
export type WorkspaceReorderPosition = 'before' | 'after';

class WorkspaceManager {
  private static instance: WorkspaceManager | null = null;
  private state: WorkspaceState;
  private listeners: Set<WorkspaceEventListener> = new Set();
  private isInitialized = false;
  private isInitializing = false;

  private constructor() {
    this.state = {
      lastUsedWorkspace: null,
      openedWorkspaces: new Map(),
      lastUsedWorkspaceId: null,
      recentWorkspaces: [],
      loading: true,
      error: null,
    };
  }

  public static getInstance(): WorkspaceManager {
    if (!WorkspaceManager.instance) {
      WorkspaceManager.instance = new WorkspaceManager();
    }
    return WorkspaceManager.instance;
  }

  public getState(): WorkspaceState {
    return {
      ...this.state,
      openedWorkspaces: new Map(this.state.openedWorkspaces),
    };
  }

  public addEventListener(listener: WorkspaceEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: WorkspaceEvent): void {
    log.debug('Emitting event', { type: event.type });
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        log.error('Event listener execution error', { eventType: event.type, error });
      }
    });
  }

  private updateState(updates: Partial<WorkspaceState>, event?: WorkspaceEvent): void {
    this.state = {
      ...this.state,
      ...updates,
      openedWorkspaces: updates.openedWorkspaces
        ? new Map(updates.openedWorkspaces)
        : this.state.openedWorkspaces,
    };

    log.debug('State updated', {
      lastUsedWorkspaceId: this.state.lastUsedWorkspaceId,
      openedWorkspaceCount: this.state.openedWorkspaces.size,
    });

    if (event) {
      this.emit(event);
    }
  }

  private setLoading(loading: boolean): void {
    this.updateState({ loading }, { type: 'workspace:loading', loading });
  }

  private setError(error: string | null): void {
    this.updateState({ error }, { type: 'workspace:error', error });
  }

  private buildOpenedWorkspaceMap(workspaces: WorkspaceInfo[]): Map<string, WorkspaceInfo> {
    return new Map(workspaces.map(workspace => [workspace.id, workspace]));
  }

  private getOpenedWorkspacesList(): WorkspaceInfo[] {
    return Array.from(this.state.openedWorkspaces.values());
  }

  private isWorkspaceInSection(workspace: WorkspaceInfo, _section: WorkspaceSection): boolean {
    return Boolean(workspace);
  }

  private preserveOpenedWorkspaceOrder(workspaces: WorkspaceInfo[]): WorkspaceInfo[] {
    const currentOrder = Array.from(this.state.openedWorkspaces.keys());
    const nextWorkspaceMap = this.buildOpenedWorkspaceMap(workspaces);
    const orderedWorkspaces = currentOrder
      .map(workspaceId => nextWorkspaceMap.get(workspaceId))
      .filter((workspace): workspace is WorkspaceInfo => Boolean(workspace));

    const existingIds = new Set(orderedWorkspaces.map(workspace => workspace.id));

    for (const workspace of workspaces) {
      if (!existingIds.has(workspace.id)) {
        orderedWorkspaces.push(workspace);
      }
    }

    return orderedWorkspaces;
  }

  private buildReorderedOpenedWorkspaceIds(
    section: WorkspaceSection,
    sourceWorkspaceId: string,
    targetWorkspaceId: string,
    position: WorkspaceReorderPosition
  ): string[] | null {
    if (sourceWorkspaceId === targetWorkspaceId) {
      return null;
    }

    const openedWorkspaces = this.getOpenedWorkspacesList();
    const workspaceMap = this.buildOpenedWorkspaceMap(openedWorkspaces);
    const sourceWorkspace = workspaceMap.get(sourceWorkspaceId);
    const targetWorkspace = workspaceMap.get(targetWorkspaceId);

    if (!sourceWorkspace || !targetWorkspace) {
      return null;
    }

    if (
      !this.isWorkspaceInSection(sourceWorkspace, section) ||
      !this.isWorkspaceInSection(targetWorkspace, section)
    ) {
      return null;
    }

    const sectionWorkspaceIds = openedWorkspaces
      .filter(workspace => this.isWorkspaceInSection(workspace, section))
      .map(workspace => workspace.id);
    const sourceIndex = sectionWorkspaceIds.indexOf(sourceWorkspaceId);
    const targetIndex = sectionWorkspaceIds.indexOf(targetWorkspaceId);

    if (sourceIndex === -1 || targetIndex === -1) {
      return null;
    }

    const reorderedSectionWorkspaceIds = [...sectionWorkspaceIds];
    reorderedSectionWorkspaceIds.splice(sourceIndex, 1);

    const insertionBaseIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    const insertionIndex = position === 'after'
      ? insertionBaseIndex + 1
      : insertionBaseIndex;

    reorderedSectionWorkspaceIds.splice(insertionIndex, 0, sourceWorkspaceId);

    const reorderedOpenedWorkspaceIds: string[] = [];
    let sectionCursor = 0;

    for (const workspace of openedWorkspaces) {
      if (this.isWorkspaceInSection(workspace, section)) {
        reorderedOpenedWorkspaceIds.push(reorderedSectionWorkspaceIds[sectionCursor]);
        sectionCursor += 1;
      } else {
        reorderedOpenedWorkspaceIds.push(workspace.id);
      }
    }

    return reorderedOpenedWorkspaceIds;
  }

  private resolveLastUsedWorkspaceId(
    lastUsedWorkspace: WorkspaceInfo | null,
    recentWorkspaces: WorkspaceInfo[],
    openedWorkspaces: Map<string, WorkspaceInfo>
  ): string | null {
    return (
      lastUsedWorkspace?.id ||
      recentWorkspaces[0]?.id ||
      openedWorkspaces.keys().next().value ||
      null
    );
  }

  private updateWorkspaceState(
    lastUsedWorkspace: WorkspaceInfo | null,
    recentWorkspaces: WorkspaceInfo[],
    openedWorkspaces: WorkspaceInfo[],
    loading: boolean,
    error: string | null,
    event?: WorkspaceEvent
  ): void {
    const openedWorkspaceMap = this.buildOpenedWorkspaceMap(openedWorkspaces);

    const resolvedLastUsedWorkspace = lastUsedWorkspace
      ? openedWorkspaceMap.get(lastUsedWorkspace.id) ?? lastUsedWorkspace
      : null;

    this.updateState(
      {
        lastUsedWorkspace: resolvedLastUsedWorkspace,
        openedWorkspaces: openedWorkspaceMap,
        lastUsedWorkspaceId: this.resolveLastUsedWorkspaceId(
          resolvedLastUsedWorkspace,
          recentWorkspaces,
          openedWorkspaceMap
        ),
        recentWorkspaces,
        loading,
        error,
      },
      event
    );
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized || this.isInitializing) {
      return;
    }

    try {
      this.isInitializing = true;
      log.info('Initializing workspace state');

      const initResult = await globalStateAPI.initializeGlobalState();
      log.debug('Backend initialization completed', { result: initResult });
      await globalStateAPI.cleanupInvalidWorkspaces();

      const [recentWorkspaces, openedWorkspaces, lastUsedWorkspace] = await Promise.all([
        globalStateAPI.getRecentWorkspaces(),
        globalStateAPI.getOpenedWorkspaces(),
        globalStateAPI.getLastUsedWorkspace(),
      ]);

      this.updateWorkspaceState(
        lastUsedWorkspace,
        recentWorkspaces,
        openedWorkspaces,
        false,
        null,
        lastUsedWorkspace
          ? { type: 'workspace:opened', workspace: lastUsedWorkspace }
          : undefined
      );

      this.emit({ type: 'workspace:loading', loading: false });
      this.isInitialized = true;
      log.info('Workspace state initialization completed', {
        lastUsedWorkspaceId: lastUsedWorkspace?.id ?? null,
        openedWorkspaceCount: openedWorkspaces.length,
      });
    } catch (error) {
      log.error('Failed to initialize workspace state', { error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateWorkspaceState(null, [], [], false, errorMessage);
      this.emit({ type: 'workspace:error', error: errorMessage });
    } finally {
      this.isInitializing = false;
    }
  }

  public async openWorkspace(path: string): Promise<WorkspaceInfo> {
    try {
      this.setLoading(true);
      this.setError(null);

      log.info('Opening workspace', { path });

      const workspace = await globalStateAPI.openWorkspace(path);
      const [recentWorkspaces, openedWorkspaces] = await Promise.all([
        globalStateAPI.getRecentWorkspaces(),
        globalStateAPI.getOpenedWorkspaces(),
      ]);

      this.updateWorkspaceState(
        workspace,
        recentWorkspaces,
        openedWorkspaces,
        false,
        null,
        { type: 'workspace:opened', workspace }
      );

      return workspace;
    } catch (error) {
      log.error('Failed to open workspace', { path, error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState({ loading: false, error: errorMessage }, { type: 'workspace:error', error: errorMessage });
      throw error;
    }
  }

  public async openRemoteWorkspace(remoteWorkspace: {
    connectionId: string;
    connectionName: string;
    remotePath: string;
    sshHost?: string;
  }): Promise<WorkspaceInfo> {
    try {
      this.setLoading(true);
      this.setError(null);

      log.info('Opening remote workspace', remoteWorkspace);

      const remotePath = normalizeRemoteWorkspacePath(remoteWorkspace.remotePath);

      const workspace = await globalStateAPI.openRemoteWorkspace(
        remotePath,
        remoteWorkspace.connectionId,
        remoteWorkspace.connectionName,
        remoteWorkspace.sshHost,
      );

      const [recentWorkspaces, openedWorkspaces] = await Promise.all([
        globalStateAPI.getRecentWorkspaces(),
        globalStateAPI.getOpenedWorkspaces(),
      ]);

      this.updateWorkspaceState(
        workspace,
        recentWorkspaces,
        openedWorkspaces,
        false,
        null,
        { type: 'workspace:opened', workspace }
      );

      return workspace;
    } catch (error) {
      log.error('Failed to open remote workspace', { remoteWorkspace, error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState({ loading: false, error: errorMessage }, { type: 'workspace:error', error: errorMessage });
      throw error;
    }
  }

  public async removeRemoteWorkspace(connectionId: string, remotePath?: string): Promise<void> {
    try {
      const workspace = this.findRemoteWorkspace(connectionId, remotePath);
      if (!workspace) {
        return;
      }

      await globalStateAPI.closeWorkspace(workspace.id);

      const [lastUsedWorkspace, recentWorkspaces, openedWorkspaces] = await Promise.all([
        globalStateAPI.getLastUsedWorkspace(),
        globalStateAPI.getRecentWorkspaces(),
        globalStateAPI.getOpenedWorkspaces(),
      ]);

      this.updateWorkspaceState(
        lastUsedWorkspace,
        recentWorkspaces,
        openedWorkspaces,
        false,
        null,
        { type: 'workspace:closed', workspaceId: workspace.id }
      );

      this.emit({ type: 'workspace:last-used-changed', workspace: lastUsedWorkspace });
    } catch (error) {
      log.error('Failed to remove remote workspace', { connectionId, remotePath, error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState({ error: errorMessage }, { type: 'workspace:error', error: errorMessage });
      throw error;
    }
  }

  private findRemoteWorkspace(connectionId: string, remotePath?: string): WorkspaceInfo | undefined {
    const normalizedRemotePath = remotePath ? normalizeRemoteWorkspacePath(remotePath) : null;
    for (const [, ws] of this.state.openedWorkspaces) {
      if (ws.workspaceKind !== WorkspaceKind.Remote) {
        continue;
      }
      if (ws.connectionId !== connectionId) {
        continue;
      }
      if (normalizedRemotePath && normalizeRemoteWorkspacePath(ws.rootPath) !== normalizedRemotePath) {
        continue;
      }
      return ws;
    }
    return undefined;
  }

  public async closeWorkspace(): Promise<void> {
    if (!this.state.lastUsedWorkspace?.id) {
      return;
    }

    await this.closeWorkspaceById(this.state.lastUsedWorkspace.id);
  }

  public async closeWorkspaceById(workspaceId: string): Promise<void> {
    try {
      this.setLoading(true);
      this.setError(null);

      log.info('Closing workspace', { workspaceId });

      await globalStateAPI.closeWorkspace(workspaceId);

      const [lastUsedWorkspace, recentWorkspaces, openedWorkspaces] = await Promise.all([
        globalStateAPI.getLastUsedWorkspace(),
        globalStateAPI.getRecentWorkspaces(),
        globalStateAPI.getOpenedWorkspaces(),
      ]);

      this.updateWorkspaceState(
        lastUsedWorkspace,
        recentWorkspaces,
        openedWorkspaces,
        false,
        null,
        { type: 'workspace:closed', workspaceId }
      );

      this.emit({ type: 'workspace:last-used-changed', workspace: lastUsedWorkspace });
    } catch (error) {
      log.error('Failed to close workspace', { workspaceId, error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState({ loading: false, error: errorMessage }, { type: 'workspace:error', error: errorMessage });
      throw error;
    }
  }

  public async rememberWorkspace(workspaceId: string): Promise<WorkspaceInfo> {
    try {
      if (this.state.lastUsedWorkspaceId === workspaceId) {
        const lastUsedWorkspace = this.state.lastUsedWorkspace;
        if (!lastUsedWorkspace) {
          throw new Error(`Last-used workspace not found: ${workspaceId}`);
        }
        return lastUsedWorkspace;
      }

      this.setLoading(true);
      this.setError(null);

      const workspace = await globalStateAPI.rememberWorkspace(workspaceId);
      const [recentWorkspaces, openedWorkspaces] = await Promise.all([
        globalStateAPI.getRecentWorkspaces(),
        globalStateAPI.getOpenedWorkspaces(),
      ]);
      const orderedOpenedWorkspaces = this.preserveOpenedWorkspaceOrder(openedWorkspaces);

      this.updateWorkspaceState(
        workspace,
        recentWorkspaces,
        orderedOpenedWorkspaces,
        false,
        null,
        { type: 'workspace:remembered', workspace }
      );

      this.emit({ type: 'workspace:last-used-changed', workspace });
      return workspace;
    } catch (error) {
      log.error('Failed to remember workspace', { workspaceId, error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.updateState({ loading: false, error: errorMessage }, { type: 'workspace:error', error: errorMessage });
      throw error;
    }
  }

  public async reorderOpenedWorkspacesInSection(
    section: WorkspaceSection,
    sourceWorkspaceId: string,
    targetWorkspaceId: string,
    position: WorkspaceReorderPosition
  ): Promise<void> {
    const previousLastUsedWorkspace = this.state.lastUsedWorkspace;
    const previousRecentWorkspaces = this.state.recentWorkspaces;
    const previousOpenedWorkspaces = this.getOpenedWorkspacesList();
    const reorderedOpenedWorkspaceIds = this.buildReorderedOpenedWorkspaceIds(
      section,
      sourceWorkspaceId,
      targetWorkspaceId,
      position
    );

    if (!reorderedOpenedWorkspaceIds) {
      return;
    }

    const currentOpenedWorkspaceIds = previousOpenedWorkspaces.map(workspace => workspace.id);
    const hasOrderChanged = reorderedOpenedWorkspaceIds.some(
      (workspaceId, index) => workspaceId !== currentOpenedWorkspaceIds[index]
    );

    if (!hasOrderChanged) {
      return;
    }

    const workspaceMap = this.buildOpenedWorkspaceMap(previousOpenedWorkspaces);
    const reorderedOpenedWorkspaces = reorderedOpenedWorkspaceIds
      .map(workspaceId => workspaceMap.get(workspaceId))
      .filter((workspace): workspace is WorkspaceInfo => Boolean(workspace));
    const reorderedEventWorkspace = previousLastUsedWorkspace
      ?? workspaceMap.get(sourceWorkspaceId)
      ?? reorderedOpenedWorkspaces[0]
      ?? previousOpenedWorkspaces[0];

    if (!reorderedEventWorkspace) {
      return;
    }

    this.updateWorkspaceState(
      previousLastUsedWorkspace,
      previousRecentWorkspaces,
      reorderedOpenedWorkspaces,
      false,
      null,
      { type: 'workspace:updated', workspace: reorderedEventWorkspace }
    );

    try {
      await globalStateAPI.reorderOpenedWorkspaces(reorderedOpenedWorkspaceIds);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const rollbackEventWorkspace = previousLastUsedWorkspace
        ?? workspaceMap.get(sourceWorkspaceId)
        ?? previousOpenedWorkspaces[0]
        ?? reorderedEventWorkspace;
      this.updateWorkspaceState(
        previousLastUsedWorkspace,
        previousRecentWorkspaces,
        previousOpenedWorkspaces,
        false,
        errorMessage,
        { type: 'workspace:updated', workspace: rollbackEventWorkspace }
      );
      this.emit({ type: 'workspace:error', error: errorMessage });
      throw error;
    }
  }

  public async switchWorkspace(workspace: WorkspaceInfo): Promise<WorkspaceInfo> {
    if (this.state.lastUsedWorkspace?.id === workspace.id) {
      return workspace;
    }

    if (this.state.openedWorkspaces.has(workspace.id)) {
      return this.rememberWorkspace(workspace.id);
    }

    if (isRemoteWorkspace(workspace)) {
      const connectionId = workspace.connectionId?.trim() ?? '';
      const connectionName = workspace.connectionName?.trim() || connectionId;
      if (!connectionId) {
        throw new Error('Remote workspace is missing connectionId; reconnect via SSH first.');
      }
      return this.openRemoteWorkspace({
        connectionId,
        connectionName,
        remotePath: workspace.rootPath,
        sshHost: workspace.sshHost,
      });
    }

    return this.openWorkspace(workspace.rootPath);
  }

  public async scanWorkspaceInfo(): Promise<WorkspaceInfo | null> {
    try {
      if (!this.state.lastUsedWorkspace?.rootPath) {
        throw new Error('No last-used workspace available for scanning');
      }

      this.setLoading(true);
      this.setError(null);

      const updatedWorkspace = await globalStateAPI.scanWorkspaceInfo(this.state.lastUsedWorkspace.rootPath);

      if (updatedWorkspace) {
        const openedWorkspaces = new Map(this.state.openedWorkspaces);
        openedWorkspaces.set(updatedWorkspace.id, updatedWorkspace);

        const recentWorkspaces = this.state.recentWorkspaces.map(workspace =>
          workspace.id === updatedWorkspace.id ? updatedWorkspace : workspace
        );

        this.updateState(
          {
            lastUsedWorkspace: updatedWorkspace,
            openedWorkspaces,
            recentWorkspaces,
            lastUsedWorkspaceId: updatedWorkspace.id,
            loading: false,
            error: null,
          },
          { type: 'workspace:updated', workspace: updatedWorkspace }
        );
      } else {
        this.setLoading(false);
      }

      return updatedWorkspace;
    } catch (error) {
      log.error('Failed to scan workspace info', { error });
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.setError(errorMessage);
      this.setLoading(false);
      throw error;
    }
  }

  public async refreshRecentWorkspaces(): Promise<void> {
    try {
      const recentWorkspaces = await globalStateAPI.getRecentWorkspaces();
      this.updateState({ recentWorkspaces }, { type: 'workspace:recent-updated' });
      log.debug('Recent workspaces refreshed', { count: recentWorkspaces.length });
    } catch (error) {
      log.error('Failed to refresh recent workspaces', { error });
    }
  }

  public async removeWorkspaceFromRecent(workspaceId: string): Promise<void> {
    await globalStateAPI.removeWorkspaceFromRecent(workspaceId);
    await this.refreshRecentWorkspaces();
  }

  public async cleanupInvalidWorkspaces(): Promise<number> {
    try {
      const removedCount = await globalStateAPI.cleanupInvalidWorkspaces();

      if (removedCount === 0) {
        return 0;
      }

      const [lastUsedWorkspace, recentWorkspaces, openedWorkspaces] = await Promise.all([
        globalStateAPI.getLastUsedWorkspace(),
        globalStateAPI.getRecentWorkspaces(),
        globalStateAPI.getOpenedWorkspaces(),
      ]);

      this.updateWorkspaceState(
        lastUsedWorkspace,
        recentWorkspaces,
        openedWorkspaces,
        false,
        null
      );
      this.emit({ type: 'workspace:last-used-changed', workspace: lastUsedWorkspace });

      log.info('Invalid workspaces cleaned up', { removedCount });
      return removedCount;
    } catch (error) {
      log.error('Failed to cleanup invalid workspaces', { error });
      throw error;
    }
  }

  public hasWorkspace(): boolean {
    return !!this.state.lastUsedWorkspace;
  }

  public getWorkspaceName(): string {
    return this.state.lastUsedWorkspace?.name || '';
  }

  public getWorkspacePath(): string {
    return this.state.lastUsedWorkspace?.rootPath || '';
  }
}

export const workspaceManager = WorkspaceManager.getInstance();

export { WorkspaceManager };


