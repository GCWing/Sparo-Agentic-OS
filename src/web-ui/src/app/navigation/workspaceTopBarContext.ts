import type { WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import type { ProductAppWorkMultiplicity } from '@/shared/types/app-manifest';
import type { ProductAppRuntimeSessionMetadata } from '@/shared/types/session-history';
import type { WorkspaceSurfaceContext } from './workspaceSurfaceTypes';

export interface WorkspaceTopBarWorkContext {
  workId: string;
  title: string;
}

export interface ProductAppTopBarContext {
  appName: string;
  workMultiplicity?: ProductAppWorkMultiplicity;
  scopeKind: 'global' | 'workspace';
}

export interface SessionTopBarPresentation {
  identityLabel: string;
  scopeLabel: string;
  scopeKind: 'global' | 'workspace' | null;
  title: string;
  isProductApp: boolean;
}

export function resolveProductAppTopBarContext(
  metadata?: ProductAppRuntimeSessionMetadata | null,
): ProductAppTopBarContext | null {
  if (!metadata) return null;
  const appName = metadata.appName.trim()
    || metadata.hostSurfaceName?.trim()
    || metadata.appId.trim();
  if (!appName) return null;

  return {
    appName,
    workMultiplicity: metadata.workMultiplicity,
    scopeKind: metadata.scope.kind === 'workspace' ? 'workspace' : 'global',
  };
}

export function resolveSessionTopBarPresentation(input: {
  sessionLabel: string;
  workspaceLabel?: string | null;
  globalScopeLabel: string;
  productApp?: ProductAppTopBarContext | null;
}): SessionTopBarPresentation {
  const sessionLabel = input.sessionLabel.trim();
  const workspaceLabel = input.workspaceLabel?.trim() ?? '';
  const productApp = input.productApp;

  if (productApp) {
    // Legacy sessions may not carry multiplicity until they are reopened and
    // refreshed. Showing their scope is safer than silently presenting a
    // multi-Work application as a singleton.
    const showsScope = productApp.workMultiplicity !== 'singleton';
    const scopeLabel = showsScope
      ? (productApp.scopeKind === 'global' ? input.globalScopeLabel.trim() : workspaceLabel)
      : '';
    return {
      identityLabel: productApp.appName,
      scopeLabel,
      scopeKind: scopeLabel ? productApp.scopeKind : null,
      title: scopeLabel ? `${productApp.appName} / ${scopeLabel}` : productApp.appName,
      isProductApp: true,
    };
  }

  return {
    identityLabel: sessionLabel,
    scopeLabel: workspaceLabel,
    scopeKind: workspaceLabel ? 'workspace' : null,
    title: workspaceLabel ? `${sessionLabel} / ${workspaceLabel}` : sessionLabel,
    isProductApp: false,
  };
}

export function resolveWorkspaceTopBarTitle(input: {
  surfaceKind: 'agentic-os-home' | 'scene' | 'session';
  sessionPresentation?: SessionTopBarPresentation | null;
  sessionTitle: string;
  workTitle?: string | null;
  overrideTitle?: string | null;
  sceneTitle?: string | null;
}): string {
  if (input.surfaceKind === 'session' && input.sessionPresentation?.isProductApp) {
    return input.sessionTitle;
  }
  return input.workTitle
    || input.overrideTitle
    || (input.surfaceKind === 'scene' ? input.sceneTitle : input.sessionTitle)
    || '';
}

export function resolveWorkContextForSurface(
  context: WorkspaceSurfaceContext | null,
  works: readonly WorkRecord[]
): WorkspaceTopBarWorkContext | null {
  if (context?.kind !== 'work') {
    return null;
  }

  const work = works.find(candidate => candidate.id === context.workId);
  if (!work) {
    return null;
  }

  return {
    workId: work.id,
    title: work.title.trim() || work.id.slice(0, 10),
  };
}
