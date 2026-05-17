/**
 * Design artifact store.
 *
 * Central cache of design artifacts for the right-side Design Canvas tab.
 * Populated from DesignArtifact tool results surfaced by the flow-chat
 * event pipeline, and also from direct reads via workspaceAPI for files
 * the agent has produced.
 */

import { create } from 'zustand';

export interface DesignArtifactFileEntry {
  path: string;
  size?: number;
  sha256?: string;
  updated_at?: string;
}

export interface DesignArtifactVersion {
  id: string;
  parent?: string | null;
  author: string;
  summary: string;
  created_at: string;
}

export interface DesignArtifactLock {
  holder: string;
  since: string;
  note?: string;
}

export interface DesignArtifactManifest {
  id: string;
  title: string;
  kind: string;
  entry: string;
  viewports: string[];
  files: DesignArtifactFileEntry[];
  root: string;
  current_version?: string | null;
  versions: DesignArtifactVersion[];
  editing_lock?: DesignArtifactLock | null;
  thumbnail?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SelectedElement {
  domPath?: string;
  tagName?: string;
  textExcerpt?: string;
  /** Flattened computed style map (value -> string) for the Inspector panel. */
  computedStyle?: Record<string, string>;
  rect?: { x: number; y: number; width: number; height: number };
}

export type ArtifactEventKind =
  | 'created'
  | 'file-changed'
  | 'file-removed'
  | 'manifest-updated'
  | 'snapshot-committed'
  | 'tokens-proposed'
  | 'tokens-committed'
  | 'listed'
  | 'ok';

export interface DesignArtifactState {
  manifest: DesignArtifactManifest;
  lastEvent?: ArtifactEventKind;
  lastUpdatedAt?: number;
  generation: number;
  /** Cached file contents (relative path -> content). Populated on demand. */
  fileCache: Record<string, string>;
  /** Extracted Design Tokens keyed by CSS custom property name. */
  tokens?: Record<string, string>;
  /** Selected element path inside the preview iframe (for Continue-with-Agent). */
  selectedElement?: SelectedElement;
  /** True while the agent is writing �?UI should lock Monaco to read-only. */
  editingLock?: boolean;
}

interface DesignArtifactStore {
  artifacts: Record<string, DesignArtifactState>;
  autoOpenTabs: boolean;

  upsertManifest: (manifest: DesignArtifactManifest, event?: ArtifactEventKind) => void;
  upsertManifests: (manifests: DesignArtifactManifest[]) => void;
  setFileContent: (artifactId: string, path: string, content: string) => void;
  setSelectedElement: (
    artifactId: string,
    selection: DesignArtifactState['selectedElement']
  ) => void;
  setTokens: (artifactId: string, tokens: Record<string, string>) => void;
  setEditingLock: (artifactId: string, locked: boolean) => void;
  removeFile: (artifactId: string, path: string) => void;
  clearArtifact: (artifactId: string) => void;
  setAutoOpenTabs: (enabled: boolean) => void;
}

const ARTIFACT_BROADCAST_EVENT = 'sparo:design-artifact-changed';

function fileCacheKey(file: DesignArtifactFileEntry): string {
  return `${file.sha256 ?? ''}:${file.updated_at ?? ''}:${file.size ?? ''}`;
}

function buildFileCacheKeys(manifest?: DesignArtifactManifest): Record<string, string> {
  if (!manifest) return {};
  const keys: Record<string, string> = {};
  for (const file of manifest.files ?? []) {
    keys[file.path] = fileCacheKey(file);
  }
  return keys;
}

function preserveFreshFileCache(
  previous: DesignArtifactState | undefined,
  manifest: DesignArtifactManifest
): Record<string, string> {
  if (!previous?.fileCache) return {};
  const previousKeys = buildFileCacheKeys(previous.manifest);
  const nextKeys = buildFileCacheKeys(manifest);
  const freshCache: Record<string, string> = {};

  for (const [path, content] of Object.entries(previous.fileCache)) {
    if (nextKeys[path] && previousKeys[path] === nextKeys[path]) {
      freshCache[path] = content;
    }
  }

  return freshCache;
}

function broadcastChange(artifactId: string, event: ArtifactEventKind): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(ARTIFACT_BROADCAST_EVENT, {
        detail: { artifactId, event },
      })
    );
  } catch {
    /* no-op */
  }
}

export const DESIGN_ARTIFACT_BROADCAST_EVENT = ARTIFACT_BROADCAST_EVENT;

export const useDesignArtifactStore = create<DesignArtifactStore>((set) => ({
  artifacts: {},
  autoOpenTabs: false,

  upsertManifest: (manifest, event = 'ok') =>
    set((state) => {
      const previous = state.artifacts[manifest.id];
      const next: DesignArtifactState = {
        ...previous,
        manifest,
        lastEvent: event,
        lastUpdatedAt: Date.now(),
        generation: (previous?.generation ?? 0) + 1,
        fileCache: preserveFreshFileCache(previous, manifest),
        editingLock: previous?.editingLock ?? false,
      };
      broadcastChange(manifest.id, event);
      return {
        artifacts: {
          ...state.artifacts,
          [manifest.id]: next,
        },
      };
    }),

  upsertManifests: (manifests) =>
    set((state) => {
      const next = { ...state.artifacts };
      for (const manifest of manifests) {
        const previous = next[manifest.id];
        next[manifest.id] = {
          ...previous,
          manifest,
          lastEvent: 'listed',
          lastUpdatedAt: Date.now(),
          generation: (previous?.generation ?? 0) + 1,
          fileCache: preserveFreshFileCache(previous, manifest),
          editingLock: previous?.editingLock ?? false,
        };
      }
      return { artifacts: next };
    }),

  setFileContent: (artifactId, path, content) =>
    set((state) => {
      const entry = state.artifacts[artifactId];
      if (!entry) return state;
      return {
        artifacts: {
          ...state.artifacts,
          [artifactId]: {
            ...entry,
            generation: entry.generation + 1,
            fileCache: { ...entry.fileCache, [path]: content },
          },
        },
      };
    }),

  setSelectedElement: (artifactId, selection) =>
    set((state) => {
      const entry = state.artifacts[artifactId];
      if (!entry) return state;
      return {
        artifacts: {
          ...state.artifacts,
          [artifactId]: { ...entry, selectedElement: selection },
        },
      };
    }),

  setTokens: (artifactId, tokens) =>
    set((state) => {
      const entry = state.artifacts[artifactId];
      if (!entry) return state;
      return {
        artifacts: {
          ...state.artifacts,
          [artifactId]: { ...entry, tokens },
        },
      };
    }),

  setEditingLock: (artifactId, locked) =>
    set((state) => {
      const entry = state.artifacts[artifactId];
      if (!entry) return state;
      return {
        artifacts: {
          ...state.artifacts,
          [artifactId]: { ...entry, editingLock: locked },
        },
      };
    }),

  removeFile: (artifactId, path) =>
    set((state) => {
      const entry = state.artifacts[artifactId];
      if (!entry) return state;
      const { [path]: _removed, ...rest } = entry.fileCache;
      return {
        artifacts: {
          ...state.artifacts,
          [artifactId]: { ...entry, fileCache: rest },
        },
      };
    }),

  clearArtifact: (artifactId) =>
    set((state) => {
      const { [artifactId]: _removed, ...rest } = state.artifacts;
      return { artifacts: rest };
    }),

  setAutoOpenTabs: (enabled) => set({ autoOpenTabs: enabled }),
}));

export function getArtifact(id: string): DesignArtifactState | undefined {
  return useDesignArtifactStore.getState().artifacts[id];
}
