import { useEffect, useMemo } from 'react';
import { useCanvasStore } from '@/app/components/panels/content-canvas';
import { useAgentCanvasStore } from '@/app/components/panels/content-canvas/stores';
import {
  selectFocusedSessionId,
  useWorkspaceSurfaceStore,
} from '@/app/navigation/workspaceSurfaceStore';
import { useProductAppRuntimeStore } from '@/app/scenes/apps/product-app-runtime/productAppRuntimeStore';
import { useSessionProfile } from '@/app/session-profiles';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { isSessionTranscriptLoading } from '@/flow_chat/domain/sessionLoadPhase';
import { useActiveSession } from '@/flow_chat/store/modernFlowChatStore';
import {
  appScopeFromWorkScope,
  type AppScope,
} from '@/shared/types/app-scope';
import { createLogger } from '@/shared/utils/logger';
import { useAuxiliarySurfaceStore } from './auxiliarySurfaceStore';
import {
  openActiveAuxiliaryItemAtPresentation,
  openAuxiliaryItem,
  registerAuxiliarySurfaceRestorer,
} from './controller';
import { registerComposerContextWorkspaceHost } from '@/flow_chat/domain/composerContextWorkspacePort';

const log = createLogger('AuxiliarySurfaceCoordinator');

function workSessionScopeToAppScope(
  sessionId: string | undefined,
  works: ReturnType<typeof useWorkStore.getState>['works'],
): AppScope | undefined {
  if (!sessionId) return undefined;
  const work = works.find(candidate =>
    candidate.surfaces.some(surface =>
      (surface.kind === 'work_session' || surface.kind === 'agent_session')
      && surface.sessionId === sessionId
    ),
  );
  return work ? appScopeFromWorkScope(work.scope, work.workspacePath) : undefined;
}

/**
 * Reconciles profile policy and live content for the active session host.
 * It does not own navigation and never mutates an inactive host.
 */
export function AuxiliarySurfaceCoordinator(): null {
  useEffect(() => registerComposerContextWorkspaceHost({
    open: ({ item, presentation }) => openActiveAuxiliaryItemAtPresentation(
      item as Parameters<typeof openActiveAuxiliaryItemAtPresentation>[0],
      presentation,
    ),
    hasItem: duplicateCheckKey => Boolean(
      useAgentCanvasStore.getState().findTabByMetadata({ duplicateCheckKey }),
    ),
  }), []);
  const { profile } = useSessionProfile();
  const focusedSessionId = useWorkspaceSurfaceStore(selectFocusedSessionId);
  const activeSession = useActiveSession();
  const works = useWorkStore(state => state.works);
  const activeHostKey = useAuxiliarySurfaceStore(state => state.activeHostKey);
  const activeHostState = useAuxiliarySurfaceStore(state => (
    state.activeHostKey ? state.hosts[state.activeHostKey] : undefined
  ));
  const configureHost = useAuxiliarySurfaceStore(state => state.configureHost);
  const reconcileItems = useAuxiliarySurfaceStore(state => state.reconcileItems);
  const markProfileInitialized = useAuxiliarySurfaceStore(
    state => state.markProfileInitialized,
  );
  const visibleItemCount = useCanvasStore(state => (
    [state.primaryGroup, state.secondaryGroup, state.tertiaryGroup]
      .flatMap(group => group.tabs)
      .filter(tab => tab.isHidden !== true)
      .length
  ));

  const runtimeAppId = useProductAppRuntimeStore(state => (
    activeSession?.sessionId
      ? state.sessionAppIds[activeSession.sessionId]
      : undefined
  ));
  const profileExtra = useMemo<Record<string, unknown> | null>(() => {
    if (!activeSession || activeSession.sessionId !== focusedSessionId) return null;
    const binding = activeSession.customMetadata?.agentSessionBinding;
    const subjectData = binding?.surface?.data;
    const boundDraftAppId =
      binding?.subject.kind === 'builder-draft'
      && subjectData
      && typeof subjectData.appId === 'string'
        ? subjectData.appId
        : undefined;
    return {
      appId: boundDraftAppId ?? runtimeAppId,
      tabTitle: 'App Builder',
      agentSessionBinding: binding,
      scope: binding?.scope ?? workSessionScopeToAppScope(activeSession.sessionId, works),
      productAppRuntime: activeSession.customMetadata?.productAppRuntime,
      customMetadata: activeSession.customMetadata,
    };
  }, [activeSession, focusedSessionId, runtimeAppId, works]);

  useEffect(() => {
    if (!activeHostKey || !focusedSessionId) return;
    configureHost(activeHostKey, profile.id, profile.auxiliarySurface.defaultVisibility);
  }, [
    activeHostKey,
    configureHost,
    focusedSessionId,
    profile.id,
    profile.auxiliarySurface.defaultVisibility,
  ]);

  useEffect(() => {
    if (!activeHostKey) return;
    reconcileItems(activeHostKey, visibleItemCount);
  }, [activeHostKey, reconcileItems, visibleItemCount]);

  useEffect(() => {
    if (
      !activeHostKey
      || !activeSession
      || activeSession.sessionId !== focusedSessionId
      || isSessionTranscriptLoading({ loadPhase: activeSession.loadPhase })
      || !profile.auxiliarySurface.restore
      || !profileExtra
    ) {
      return;
    }

    return registerAuxiliarySurfaceRestorer(activeHostKey, () => {
      const result = profile.auxiliarySurface.restore?.(
        activeSession.sessionId,
        profileExtra,
      );
      if (!result) return;
      const items = Array.isArray(result) ? result : [result];
      if (items.length === 0) return;

      log.debug('Restoring profile auxiliary items', {
        hostKey: activeHostKey,
        profileId: profile.id,
        itemTypes: items.map(item => item.type),
      });
      items.forEach(item => {
        openAuxiliaryItem({
          hostKey: activeHostKey,
          item,
          reveal: 'preserve',
        });
      });
    });
  }, [activeHostKey, activeSession, focusedSessionId, profile, profileExtra]);

  useEffect(() => {
    if (
      !activeHostKey
      || !activeHostState
      || !activeSession
      || activeSession.sessionId !== focusedSessionId
      || isSessionTranscriptLoading({ loadPhase: activeSession.loadPhase })
      || !profile.auxiliarySurface.initialize
      || activeHostState.initializedProfileIds.includes(profile.id)
      || !profileExtra
    ) {
      return;
    }

    const result = profile.auxiliarySurface.initialize(activeSession.sessionId, profileExtra);
    if (!result) return;
    const items = Array.isArray(result) ? result : [result];
    if (items.length === 0) return;

    log.debug('Initializing profile auxiliary items', {
      hostKey: activeHostKey,
      profileId: profile.id,
      itemTypes: items.map(item => item.type),
    });
    items.forEach(item => {
      openAuxiliaryItem({
        hostKey: activeHostKey,
        item,
        reveal: 'policy',
      });
    });
    markProfileInitialized(activeHostKey, profile.id);
  }, [
    activeHostKey,
    activeHostState,
    activeSession,
    focusedSessionId,
    markProfileInitialized,
    profile,
    profileExtra,
  ]);

  return null;
}
