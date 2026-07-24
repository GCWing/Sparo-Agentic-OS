import { create } from 'zustand';
import {
  AUXILIARY_SURFACE_CONFIG,
  STORAGE_KEYS,
  loadPanelWidth,
  savePanelWidth,
} from '@/app/layout/panelConfig';
import type {
  AuxiliarySurfaceDefaultVisibility,
  AuxiliarySurfaceHostKey,
  AuxiliarySurfaceHostState,
  AuxiliarySurfacePresentation,
} from './types';

const createHostState = (): AuxiliarySurfaceHostState => ({
  presentation: 'closed',
  userDisposition: 'default',
  defaultVisibility: 'collapsed',
  configuredProfileId: null,
  entryPolicyApplied: false,
  initializedProfileIds: [],
});

interface AuxiliarySurfaceState {
  activeHostKey: AuxiliarySurfaceHostKey | null;
  width: number;
  hosts: Record<string, AuxiliarySurfaceHostState>;
  activateHost: (hostKey: AuxiliarySurfaceHostKey | null) => void;
  configureHost: (
    hostKey: AuxiliarySurfaceHostKey,
    profileId: string,
    defaultVisibility: AuxiliarySurfaceDefaultVisibility,
  ) => void;
  reconcileItems: (hostKey: AuxiliarySurfaceHostKey, visibleItemCount: number) => void;
  reveal: (
    hostKey: AuxiliarySurfaceHostKey,
    source: 'user' | 'explicit' | 'policy',
    presentation?: Exclude<AuxiliarySurfacePresentation, 'closed'>,
  ) => void;
  collapse: (hostKey: AuxiliarySurfaceHostKey, source: 'user' | 'empty') => void;
  setWidth: (width: number) => void;
  markProfileInitialized: (hostKey: AuxiliarySurfaceHostKey, profileId: string) => void;
  forgetHosts: (hostKeys: readonly AuxiliarySurfaceHostKey[]) => void;
}

function updateHost(
  hosts: Record<string, AuxiliarySurfaceHostState>,
  hostKey: AuxiliarySurfaceHostKey,
  update: (state: AuxiliarySurfaceHostState) => AuxiliarySurfaceHostState,
): Record<string, AuxiliarySurfaceHostState> {
  const current = hosts[hostKey] ?? createHostState();
  return { ...hosts, [hostKey]: update(current) };
}

export const useAuxiliarySurfaceStore = create<AuxiliarySurfaceState>((set) => ({
  activeHostKey: null,
  width: loadPanelWidth(
    STORAGE_KEYS.AUXILIARY_SURFACE_WIDTH,
    AUXILIARY_SURFACE_CONFIG.COMFORTABLE_DEFAULT,
  ),
  hosts: {},

  activateHost: (hostKey) => {
    set(state => ({
      activeHostKey: hostKey,
      hosts: hostKey && !state.hosts[hostKey]
        ? { ...state.hosts, [hostKey]: createHostState() }
        : state.hosts,
    }));
  },

  configureHost: (hostKey, profileId, defaultVisibility) => {
    set(state => ({
      hosts: updateHost(state.hosts, hostKey, current => {
        if (
          current.configuredProfileId === profileId
          && current.defaultVisibility === defaultVisibility
        ) {
          return current;
        }
        return {
          ...current,
          configuredProfileId: profileId,
          defaultVisibility,
          entryPolicyApplied: false,
        };
      }),
    }));
  },

  reconcileItems: (hostKey, visibleItemCount) => {
    set(state => ({
      hosts: updateHost(state.hosts, hostKey, current => {
        if (visibleItemCount === 0) {
          return current.presentation === 'closed'
            ? current
            : { ...current, presentation: 'closed' };
        }
        if (current.entryPolicyApplied) return current;

        const presentation =
          current.userDisposition === 'closed'
            ? 'closed'
            : current.userDisposition === 'opened' || current.defaultVisibility === 'visible'
              ? 'docked'
              : 'closed';
        return {
          ...current,
          presentation,
          entryPolicyApplied: true,
        };
      }),
    }));
  },

  reveal: (hostKey, source, presentation = 'docked') => {
    set(state => ({
      hosts: updateHost(state.hosts, hostKey, current => ({
        ...current,
        presentation,
        userDisposition:
          source === 'user' || source === 'explicit'
            ? 'opened'
            : current.userDisposition,
        entryPolicyApplied: source === 'policy' ? true : current.entryPolicyApplied,
      })),
    }));
  },

  collapse: (hostKey, source) => {
    set(state => ({
      hosts: updateHost(state.hosts, hostKey, current => ({
        ...current,
        presentation: 'closed',
        userDisposition: source === 'user' ? 'closed' : current.userDisposition,
      })),
    }));
  },

  setWidth: (width) => {
    savePanelWidth(STORAGE_KEYS.AUXILIARY_SURFACE_WIDTH, width);
    set({ width });
  },

  markProfileInitialized: (hostKey, profileId) => {
    set(state => ({
      hosts: updateHost(state.hosts, hostKey, current => (
        current.initializedProfileIds.includes(profileId)
          ? current
          : {
              ...current,
              initializedProfileIds: [...current.initializedProfileIds, profileId],
            }
      )),
    }));
  },

  forgetHosts: (hostKeys) => {
    if (hostKeys.length === 0) return;
    set(state => {
      const removed = new Set<string>(hostKeys);
      const hosts = Object.fromEntries(
        Object.entries(state.hosts).filter(([key]) => !removed.has(key)),
      );
      return {
        hosts,
        activeHostKey:
          state.activeHostKey && removed.has(state.activeHostKey)
            ? null
            : state.activeHostKey,
      };
    });
  },
}));

export function selectActiveAuxiliaryHostState(
  state: AuxiliarySurfaceState,
): AuxiliarySurfaceHostState | null {
  return state.activeHostKey ? state.hosts[state.activeHostKey] ?? null : null;
}
