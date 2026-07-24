import type { WorkspaceInfo } from './global-state';
import type { WorkScope } from './work-locator';

export type AppScope =
  | { kind: 'system' }
  | {
      kind: 'workspace';
      workspacePath: string;
      workspaceId?: string | null;
      workspaceName?: string | null;
    };

export function systemAppScope(): AppScope {
  return { kind: 'system' };
}

export function normalizeWorkspacePath(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

export function appScopeFromWorkspace(workspace?: WorkspaceInfo | null): AppScope | null {
  if (!workspace) return null;
  return appScopeFromWorkspaceIdentity({
    workspaceId: workspace.id,
    workspacePath: workspace.rootPath,
    workspaceName: workspace.name,
  });
}

export function appScopeFromWorkspaceIdentity(identity: {
  workspaceId?: string | null;
  workspacePath?: string | null;
  workspaceName?: string | null;
}): Extract<AppScope, { kind: 'workspace' }> {
  const workspaceId = identity.workspaceId?.trim();
  if (!workspaceId) {
    throw new Error('Workspace scope requires workspaceId');
  }
  const workspacePath = normalizeWorkspacePath(identity.workspacePath);
  if (!workspacePath) {
    throw new Error(`Workspace ${workspaceId} scope requires workspacePath`);
  }
  return {
    kind: 'workspace',
    workspaceId,
    workspacePath,
    workspaceName: identity.workspaceName?.trim() || null,
  };
}

/** Path-only runtime context. Do not pass this result to Work persistence APIs. */
export function appScopeFromWorkspacePath(workspacePath?: string | null): AppScope | null {
  const normalized = normalizeWorkspacePath(workspacePath);
  return normalized ? { kind: 'workspace', workspacePath: normalized } : null;
}

export function workScopeFromAppScope(scope: AppScope): WorkScope {
  if (scope.kind !== 'workspace') return { kind: 'global' };
  const workspaceId = scope.workspaceId?.trim();
  if (!workspaceId) throw new Error('Workspace scope requires workspaceId');
  return { kind: 'workspace', workspaceId };
}

export function appScopeFromWorkScope(
  scope: WorkScope,
  workspacePath?: string | null,
  workspaceName?: string | null,
): AppScope {
  if (scope.kind === 'global') return systemAppScope();
  return appScopeFromWorkspaceIdentity({
    workspaceId: scope.workspaceId,
    workspacePath,
    workspaceName,
  });
}

export function normalizeAppScope(scope?: AppScope | null): AppScope {
  if (scope?.kind === 'workspace') {
    const workspacePath = normalizeWorkspacePath(scope.workspacePath);
    if (workspacePath) {
      return {
        ...scope,
        workspacePath,
      };
    }
  }
  return systemAppScope();
}

export function workspacePathFromAppScope(scope?: AppScope | null): string | undefined {
  const normalized = normalizeAppScope(scope);
  return normalized.kind === 'workspace' ? normalized.workspacePath : undefined;
}

export function appScopeIdentity(scope?: AppScope | null): string {
  const normalized = normalizeAppScope(scope);
  if (normalized.kind === 'system') return 'system';
  const workspaceId = normalized.workspaceId?.trim();
  if (workspaceId) return `workspace:${workspaceId}`;
  return `workspace-path:${normalized.workspacePath.replace(/\\/g, '/').toLowerCase()}`;
}
