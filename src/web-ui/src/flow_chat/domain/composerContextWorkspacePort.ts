export interface ComposerWorkspaceItemDescriptor {
  type: string;
  title: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
  duplicateCheckKey?: string;
  replaceExisting?: boolean;
}

export interface OpenComposerContextWorkspaceRequest {
  item: ComposerWorkspaceItemDescriptor;
  presentation: 'docked' | 'scene-focus';
}

interface ComposerContextWorkspaceHost {
  open: (request: OpenComposerContextWorkspaceRequest) => boolean;
  hasItem: (duplicateCheckKey: string) => boolean;
}

let activeHost: ComposerContextWorkspaceHost | null = null;

/** App-shell injection point; Flow Chat presents semantic requests only. */
export function registerComposerContextWorkspaceHost(
  host: ComposerContextWorkspaceHost,
): () => void {
  activeHost = host;
  return () => {
    if (activeHost === host) activeHost = null;
  };
}

export function requestComposerContextWorkspace(
  request: OpenComposerContextWorkspaceRequest,
): boolean {
  return activeHost?.open(request) ?? false;
}

export function isComposerContextWorkspaceOpen(duplicateCheckKey: string): boolean {
  return activeHost?.hasItem(duplicateCheckKey) ?? false;
}
