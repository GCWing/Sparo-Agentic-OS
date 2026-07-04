import type { WorkspaceInfo } from './global-state';
import type { AppScope } from './app-scope';
import { normalizeAppScope, systemAppScope } from './app-scope';
import type { SessionStorageScope } from './session-history';

export type RuntimeScope =
  | {
      kind: 'project';
      workspacePath: string;
      workspaceId?: string | null;
      label?: string | null;
    }
  | {
      kind: 'system';
      storageScope: 'agentic_os';
      label: 'Agentic OS';
    }
  | {
      kind: 'external';
      rootPath: string;
      label?: string | null;
    };

export interface SessionScopeFields {
  storageScope?: SessionStorageScope | null;
  workspacePath?: string | null;
  workspaceId?: string | null;
  title?: string | null;
  customMetadata?: {
    agentSessionBinding?: { scope?: AppScope | null } | null;
    productAppRuntime?: { scope?: AppScope | null } | null;
  } | null;
}

export function normalizeRuntimePath(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

export function systemRuntimeScope(): RuntimeScope {
  return {
    kind: 'system',
    storageScope: 'agentic_os',
    label: 'Agentic OS',
  };
}

export function projectRuntimeScopeFromWorkspace(
  workspace?: WorkspaceInfo | null,
): Extract<RuntimeScope, { kind: 'project' }> | null {
  const workspacePath = normalizeRuntimePath(workspace?.rootPath);
  if (!workspacePath) return null;
  return {
    kind: 'project',
    workspaceId: workspace?.id ?? null,
    workspacePath,
    label: workspace?.name ?? null,
  };
}

export function projectRuntimeScopeFromWorkspacePath(
  workspacePath?: string | null,
  label?: string | null,
): Extract<RuntimeScope, { kind: 'project' }> | null {
  const normalizedPath = normalizeRuntimePath(workspacePath);
  if (!normalizedPath) return null;
  return {
    kind: 'project',
    workspacePath: normalizedPath,
    label: label ?? null,
  };
}

export function externalRuntimeScope(
  rootPath?: string | null,
  label?: string | null,
): RuntimeScope | null {
  const normalizedPath = normalizeRuntimePath(rootPath);
  if (!normalizedPath) return null;
  return {
    kind: 'external',
    rootPath: normalizedPath,
    label: label ?? null,
  };
}

export function runtimeScopeFromSession(
  session?: SessionScopeFields | null,
): RuntimeScope | null {
  if (!session) return null;
  const boundScope =
    session.customMetadata?.productAppRuntime?.scope ??
    session.customMetadata?.agentSessionBinding?.scope ??
    null;
  if (boundScope) {
    return runtimeScopeFromAppScope(boundScope);
  }
  if (session.storageScope === 'agentic_os') {
    return systemRuntimeScope();
  }
  const projectScope = projectRuntimeScopeFromWorkspacePath(
    session.workspacePath,
    session.title,
  );
  return projectScope
    ? {
        ...projectScope,
        workspaceId: session.workspaceId ?? projectScope.workspaceId ?? null,
      }
    : null;
}

export function runtimeScopeFromAppScope(scope?: AppScope | null): RuntimeScope {
  const normalized = normalizeAppScope(scope);
  if (normalized.kind === 'system') {
    return systemRuntimeScope();
  }
  return {
    kind: 'project',
    workspacePath: normalized.workspacePath,
    workspaceId: normalized.workspaceId ?? null,
    label: normalized.workspaceName ?? null,
  };
}

export function appScopeFromRuntimeScope(scope?: RuntimeScope | null): AppScope {
  if (scope?.kind !== 'project') {
    return systemAppScope();
  }
  return {
    kind: 'workspace',
    workspacePath: scope.workspacePath,
    workspaceId: scope.workspaceId ?? null,
    workspaceName: scope.label ?? null,
  };
}

export function workspacePathFromRuntimeScope(
  scope?: RuntimeScope | null,
): string | undefined {
  if (!scope) return undefined;
  if (scope.kind === 'project') return scope.workspacePath;
  if (scope.kind === 'external') return scope.rootPath;
  return undefined;
}

export function projectWorkspacePathFromRuntimeScope(
  scope?: RuntimeScope | null,
): string | undefined {
  return scope?.kind === 'project' ? scope.workspacePath : undefined;
}

export function runtimeScopeLabel(scope?: RuntimeScope | null): string {
  if (!scope) return '';
  if (scope.kind === 'system') return scope.label;
  const explicit = scope.label?.trim();
  if (explicit) return explicit;
  const path = scope.kind === 'project' ? scope.workspacePath : scope.rootPath;
  return path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path;
}

export function runtimeScopeIdentity(scope?: RuntimeScope | null): string {
  if (!scope) return 'none';
  if (scope.kind === 'system') return 'system:agentic_os';
  const path = (scope.kind === 'project' ? scope.workspacePath : scope.rootPath)
    .replace(/\\/g, '/')
    .toLowerCase();
  return `${scope.kind}:${scope.kind === 'project' ? scope.workspaceId ?? '' : ''}:${path}`;
}
