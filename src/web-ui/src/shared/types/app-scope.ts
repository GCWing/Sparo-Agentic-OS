import type { WorkspaceInfo } from './global-state';

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
  const workspacePath = normalizeWorkspacePath(workspace?.rootPath);
  if (!workspacePath) return null;
  return {
    kind: 'workspace',
    workspacePath,
    workspaceId: workspace?.id ?? null,
    workspaceName: workspace?.name ?? null,
  };
}

export function appScopeFromWorkspacePath(workspacePath?: string | null): AppScope | null {
  const normalized = normalizeWorkspacePath(workspacePath);
  return normalized ? { kind: 'workspace', workspacePath: normalized } : null;
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
  return `workspace:${normalized.workspacePath.replace(/\\/g, '/').toLowerCase()}`;
}
