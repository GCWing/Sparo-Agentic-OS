import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppWindow, Boxes, FileText, FolderOpen, Layers3, ListChecks, MessageSquare } from 'lucide-react';
import { Dialog, Search, SelectableRow } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { findWorkspaceForSession } from '@/flow_chat/utils/workspaceScope';
import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import type { FlowChatState, Session } from '@/flow_chat/types/flow-chat';
import type { SessionMetadata } from '@/shared/types/session-history';
import type { WorkspaceInfo } from '@/shared/types';
import { sessionAPI } from '@/infrastructure/api';
import {
  appCatalogAPI,
  type ComponentDefinition,
  type ProductAppCatalogEntry,
  type WorkObjectKind,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import {
  NewWorkDialog,
  launchWorkForChoice,
  productAppWorkChoice,
} from '@/app/components/WorkDock/NewWorkDialog';
import { productAppRequiresWorkspace } from '@/app/agentic-os/work/domain/productAppLaunchPolicy';
import { useWorks } from '@/app/agentic-os/work/hooks/useWorks';
import { filterWorkProjections } from '@/app/agentic-os/work/data/workSelectors';
import { openArtifactInCenter, openWorkInCenter } from '@/app/agentic-os/work/navigation/openWork';
import type { WorkProjection } from '@/app/agentic-os/work/projections/workProjection';
import { isSystemAgenticOsSession } from '@/flow_chat/domain/sessionDescriptor';
import { notificationService } from '@/shared/notification-system';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { useAppsStore } from '@/app/scenes/apps/appsStore';
import { openAppStudioSession } from '@/app/scenes/apps/app-studio/openAppStudioSession';
import type { ArtifactRef, WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import './GlobalSearchDialog.scss';

interface GlobalSearchDialogProps {
  open: boolean;
  onClose: () => void;
}

type SearchResultKind = 'workspace' | 'work' | 'session' | 'app' | 'workObject' | 'component' | 'artifact';

interface SearchResultItem {
  kind: SearchResultKind;
  id: string;
  label: string;
  sublabel?: string;
  workspaceId?: string;
  workId?: string;
  appId?: string;
  productApp?: ProductAppCatalogEntry;
  workObject?: WorkObjectKind;
  component?: ComponentDefinition;
  artifact?: ArtifactRef;
}

const MAX_PER_GROUP = 20;
const RECENT_TASKS_DEFAULT = 5;

const getSessionTitle = (session: Session): string =>
  session.title?.trim() || `Task ${session.sessionId.slice(0, 6)}`;

const getSessionRecencyTime = (session: Session): number =>
  session.updatedAt ?? session.lastActiveAt ?? session.createdAt ?? 0;

const matchesQuery = (query: string, ...fields: (string | undefined | null)[]): boolean => {
  const normalizedQuery = query.toLowerCase();
  return fields.some(field => field && field.toLowerCase().includes(normalizedQuery));
};

function matchesProductApp(query: string, app: ProductAppCatalogEntry): boolean {
  return matchesQuery(
    query,
    app.id,
    app.name,
    app.description,
    app.goal,
    app.category,
    app.dependencySummary,
    ...(app.tags ?? [])
  );
}

function matchesComponent(query: string, component: ComponentDefinition): boolean {
  return matchesQuery(
    query,
    component.id,
    component.name,
    component.description,
    component.kind,
    component.version,
    component.implementationRef,
    ...(component.usedByApps ?? []),
    ...(component.capabilities ?? []).flatMap(capability => [
      capability.id,
      capability.title,
      capability.description,
      ...(capability.actions ?? []),
    ])
  );
}

function matchesWorkObject(query: string, app: ProductAppCatalogEntry, workObject: WorkObjectKind): boolean {
  return matchesQuery(
    query,
    app.id,
    app.name,
    app.goal,
    app.description,
    workObject.id,
    workObject.label,
    workObject.scope
  );
}

function artifactLabel(artifact: ArtifactRef): string {
  return artifact.label?.trim() || artifact.id;
}

function matchesArtifact(query: string, work: WorkRecord, artifact: ArtifactRef): boolean {
  return matchesQuery(
    query,
    artifact.id,
    artifact.label,
    artifact.uri,
    work.title,
    work.objective
  );
}

function buildWorkResult(
  work: WorkProjection,
  workspaces: WorkspaceInfo[],
  t: (key: string, params?: Record<string, string | number>) => string
): SearchResultItem {
  const workspace = work.workspacePath
    ? workspaces.find(item => item.rootPath === work.workspacePath)
    : undefined;
  const workspaceLabel = workspace?.name ?? work.workspacePath;
  const status = t(`nav.workDock.status.${work.status}`);
  return {
    kind: 'work',
    id: work.id,
    label: work.title,
    sublabel: workspaceLabel
      ? t('nav.search.workWorkspaceHint', { status, workspace: workspaceLabel })
      : t('nav.search.workHint', { status }),
  };
}

function buildArtifactResult(
  work: WorkRecord,
  artifact: ArtifactRef,
  t: (key: string, params?: Record<string, string | number>) => string
): SearchResultItem {
  return {
    kind: 'artifact',
    id: `artifact:${work.id}:${artifact.id}`,
    workId: work.id,
    label: artifactLabel(artifact),
    sublabel: t('nav.search.artifactHint', { work: work.title }),
    artifact,
  };
}

type MergedSessionEntry =
  | { session: Session; workspace: WorkspaceInfo }
  | { disk: SessionMetadata; workspace: WorkspaceInfo };

/** Agentic OS sessions live in the agentic_os storage scope. */
function isAgenticOsSession(session: Session): boolean {
  return isSystemAgenticOsSession(session.descriptor);
}

function isAgenticOsMetadata(meta: SessionMetadata): boolean {
  const agentType = meta.agentType?.toLowerCase();
  if (agentType === 'osagent' || agentType === 'os-agent' || agentType === 'os_agent') return true;
  if (agentType === 'dispatcher') return true;
  return false;
}

function buildMergedSessionEntries(
  topLevelSessions: Array<{ session: Session; workspace: WorkspaceInfo }>,
  persistedOpenWorkspaceSessions: Array<{ meta: SessionMetadata; workspace: WorkspaceInfo }>,
  openedWorkspaceIdSet: Set<string>,
  queryTrimmed: string,
  options?: { excludeAgenticOs?: boolean }
): MergedSessionEntry[] {
  const excludeAgenticOs = options?.excludeAgenticOs ?? false;

  let candidateTopLevel = topLevelSessions;
  if (excludeAgenticOs) {
    candidateTopLevel = candidateTopLevel.filter(
      ({ session }) => !isAgenticOsSession(session)
    );
  }

  const storeMatches = queryTrimmed
    ? candidateTopLevel.filter(({ session }) =>
        matchesQuery(queryTrimmed, getSessionTitle(session), session.sessionId)
      )
    : candidateTopLevel;
  const loadedSessionIds = new Set(storeMatches.map(({ session }) => session.sessionId));

  const diskMatches = persistedOpenWorkspaceSessions.filter(({ meta, workspace }) => {
    if (excludeAgenticOs && isAgenticOsMetadata(meta)) return false;
    if (!openedWorkspaceIdSet.has(workspace.id)) return false;
    if (meta.customMetadata?.parentSessionId) return false;
    const label = meta.sessionName?.trim() || `Task ${meta.sessionId.slice(0, 6)}`;
    if (queryTrimmed && !matchesQuery(queryTrimmed, label, meta.sessionId)) return false;
    return !loadedSessionIds.has(meta.sessionId);
  });

  const mergedEntries: MergedSessionEntry[] = [
    ...storeMatches.map(({ session, workspace }) => ({ session, workspace })),
    ...diskMatches.map(({ meta, workspace }) => ({ disk: meta, workspace })),
  ];
  mergedEntries.sort((left, right) => {
    const leftTime =
      'session' in left
        ? getSessionRecencyTime(left.session)
        : left.disk.lastActiveAt ?? left.disk.createdAt ?? 0;
    const rightTime =
      'session' in right
        ? getSessionRecencyTime(right.session)
        : right.disk.lastActiveAt ?? right.disk.createdAt ?? 0;
    return rightTime - leftTime;
  });

  return mergedEntries;
}

const GlobalSearchDialog: React.FC<GlobalSearchDialogProps> = ({ open, onClose }) => {
  const { t } = useI18n('common');
  const { t: tApps } = useI18n('scenes/apps');
  const { openedWorkspacesList, lastUsedWorkspace, rememberWorkspace } = useWorkspaceContext();
  const { works, projections } = useWorks();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [productApps, setProductApps] = useState<ProductAppCatalogEntry[]>([]);
  const [workspaceLaunchApp, setWorkspaceLaunchApp] = useState<ProductAppCatalogEntry | null>(null);
  const [components, setComponents] = useState<ComponentDefinition[]>([]);
  const [flowChatState, setFlowChatState] = useState<FlowChatState>(() => flowChatStore.getState());
  const [persistedOpenWorkspaceSessions, setPersistedOpenWorkspaceSessions] = useState<
    Array<{ meta: SessionMetadata; workspace: WorkspaceInfo }>
  >([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setFlowChatState(flowChatStore.getState());
    const unsubscribe = flowChatStore.subscribeSelector(
      state => state,
      nextState => setFlowChatState(nextState),
    );
    return () => unsubscribe();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPersistedOpenWorkspaceSessions([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const rows: Array<{ meta: SessionMetadata; workspace: WorkspaceInfo }> = [];
        for (const workspace of openedWorkspacesList) {
          const sessionList = await sessionAPI.listSessions(workspace.rootPath);
          for (const meta of sessionList) {
            rows.push({ meta, workspace });
          }
        }
        if (!cancelled) {
          setPersistedOpenWorkspaceSessions(rows);
        }
      } catch {
        if (!cancelled) {
          setPersistedOpenWorkspaceSessions([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, openedWorkspacesList]);

  useEffect(() => {
    if (!open) {
      setProductApps([]);
      setComponents([]);
      return;
    }

    let cancelled = false;
    void Promise.all([
      appCatalogAPI.listAppCatalog(),
      appCatalogAPI.listComponents(),
    ])
      .then(([catalog, componentItems]) => {
        if (!cancelled) {
          const appsByKey = new Map<string, ProductAppCatalogEntry>();
          for (const app of catalog.productApps.installed) {
            if (!app.enabled) continue;
            if ((app.catalogIssues?.length ?? 0) > 0) continue;
            appsByKey.set(`${app.id}@${app.version}@${app.componentLockDigest}`, app);
          }
          setProductApps([...appsByKey.values()]);
          setComponents(componentItems);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProductApps([]);
          setComponents([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const openedWorkspaceIdSet = useMemo(
    () => new Set(openedWorkspacesList.map(workspace => workspace.id)),
    [openedWorkspacesList]
  );

  const sessionsInOpenedWorkspaces = useMemo((): Array<{ session: Session; workspace: WorkspaceInfo }> => {
    const result: Array<{ session: Session; workspace: WorkspaceInfo }> = [];
    for (const session of flowChatState.sessions.values()) {
      const workspace = findWorkspaceForSession(session, openedWorkspacesList);
      if (workspace && openedWorkspaceIdSet.has(workspace.id)) {
        result.push({ session, workspace });
      }
    }
    result.sort((left, right) => getSessionRecencyTime(right.session) - getSessionRecencyTime(left.session));
    return result;
  }, [flowChatState.sessions, openedWorkspacesList, openedWorkspaceIdSet]);

  const topLevelSessions = useMemo(
    () => sessionsInOpenedWorkspaces.filter(({ session }) => !session.parentSessionId),
    [sessionsInOpenedWorkspaces]
  );

  const results = useMemo((): SearchResultItem[] => {
    const items: SearchResultItem[] = [];
    const trimmedQuery = query.trim();
    const visibleWorks = projections.filter(work => work.status !== 'archived');
    const matchedWorks = trimmedQuery
      ? filterWorkProjections(visibleWorks, trimmedQuery).slice(0, MAX_PER_GROUP)
      : visibleWorks.slice(0, RECENT_TASKS_DEFAULT);
    const matchedWorkSessionIds = new Set(
      matchedWorks
        .map(work => work.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId))
    );

    for (const work of matchedWorks) {
      items.push(buildWorkResult(work, openedWorkspacesList, t));
    }

    if (!trimmedQuery) {
      const mergedEntries = buildMergedSessionEntries(
        topLevelSessions,
        persistedOpenWorkspaceSessions,
        openedWorkspaceIdSet,
        '',
        { excludeAgenticOs: true }
      );
      for (const entry of mergedEntries
        .filter(entry => {
          const sessionId = 'session' in entry ? entry.session.sessionId : entry.disk.sessionId;
          return !matchedWorkSessionIds.has(sessionId);
        })
        .slice(0, RECENT_TASKS_DEFAULT)
      ) {
        if ('session' in entry) {
          const { session, workspace } = entry;
          items.push({
            kind: 'session',
            id: session.sessionId,
            label: getSessionTitle(session),
            sublabel: t('nav.search.sessionWorkspaceHint', { workspace: workspace.name }),
            workspaceId: workspace.id,
          });
        } else {
          const { disk, workspace } = entry;
          items.push({
            kind: 'session',
            id: disk.sessionId,
            label: disk.sessionName?.trim() || `Task ${disk.sessionId.slice(0, 6)}`,
            sublabel: t('nav.search.sessionWorkspaceHint', { workspace: workspace.name }),
            workspaceId: workspace.id,
          });
        }
      }
      return items;
    }

    const filteredWorkspaces = openedWorkspacesList
      .filter(workspace => matchesQuery(trimmedQuery, workspace.name, workspace.rootPath))
      .slice(0, MAX_PER_GROUP);
    for (const workspace of filteredWorkspaces) {
      items.push({
        kind: 'workspace',
        id: workspace.id,
        label: workspace.name,
        sublabel: workspace.rootPath,
      });
    }

    const filteredProductApps = productApps
      .filter(app => matchesProductApp(trimmedQuery, app))
      .slice(0, MAX_PER_GROUP);
    for (const app of filteredProductApps) {
      items.push({
        kind: 'app',
        id: app.id,
        label: app.name,
        sublabel: app.goal || app.description,
        productApp: app,
      });
    }

    const workObjectMatches: SearchResultItem[] = [];
    for (const app of productApps) {
      for (const workObject of app.workObjectKinds ?? []) {
        if (!matchesWorkObject(trimmedQuery, app, workObject)) continue;
        const scope = tApps(`productSystem.workObjectScope.${workObject.scope}`);
        workObjectMatches.push({
          kind: 'workObject',
          id: `work-object:${app.id}:${workObject.id}`,
          appId: app.id,
          label: workObject.label || workObject.id,
          sublabel: t('nav.search.workObjectHint', { app: app.name, scope }),
          productApp: app,
          workObject,
        });
      }
    }
    items.push(...workObjectMatches.slice(0, MAX_PER_GROUP));

    const filteredComponents = components
      .filter(component => matchesComponent(trimmedQuery, component))
      .slice(0, MAX_PER_GROUP);
    for (const component of filteredComponents) {
      items.push({
        kind: 'component',
        id: `${component.kind}:${component.id}`,
        label: component.name,
        sublabel: `${tApps(`productSystem.componentKinds.${component.kind}`)} · ${component.description}`,
        component,
      });
    }

    const artifactMatches = works
      .filter(work => work.status !== 'archived')
      .flatMap(work => (work.artifactRefs ?? [])
        .filter(artifact => matchesArtifact(trimmedQuery, work, artifact))
        .map(artifact => buildArtifactResult(work, artifact, t))
      )
      .slice(0, MAX_PER_GROUP);
    items.push(...artifactMatches);

    const mergedEntries = buildMergedSessionEntries(
      topLevelSessions,
      persistedOpenWorkspaceSessions,
      openedWorkspaceIdSet,
      trimmedQuery
    );

    for (const entry of mergedEntries
      .filter(entry => {
        const sessionId = 'session' in entry ? entry.session.sessionId : entry.disk.sessionId;
        return !matchedWorkSessionIds.has(sessionId);
      })
      .slice(0, MAX_PER_GROUP)
    ) {
      if ('session' in entry) {
        const { session, workspace } = entry;
        items.push({
          kind: 'session',
          id: session.sessionId,
          label: getSessionTitle(session),
          sublabel: t('nav.search.sessionWorkspaceHint', { workspace: workspace.name }),
          workspaceId: workspace.id,
        });
      } else {
        const { disk, workspace } = entry;
        items.push({
          kind: 'session',
          id: disk.sessionId,
          label: disk.sessionName?.trim() || `Task ${disk.sessionId.slice(0, 6)}`,
          sublabel: t('nav.search.sessionWorkspaceHint', { workspace: workspace.name }),
          workspaceId: workspace.id,
        });
      }
    }

    return items;
  }, [
    components,
    openedWorkspaceIdSet,
    openedWorkspacesList,
    persistedOpenWorkspaceSessions,
    productApps,
    projections,
    query,
    t,
    tApps,
    topLevelSessions,
    works,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results.length]);

  const handleSelect = useCallback(async (item: SearchResultItem) => {
    onClose();
    if (item.kind === 'workspace') {
      await rememberWorkspace(item.id);
      return;
    }

    if (item.kind === 'work') {
      openWorkInCenter(item.id);
      return;
    }

    if (item.kind === 'app' && item.productApp) {
      const app = item.productApp;
      try {
        if (app.launch?.kind === 'applicationSurface' || app.launch?.kind === 'agentSession') {
          if (productAppRequiresWorkspace(app)) {
            setWorkspaceLaunchApp(app);
            return;
          }
          await launchWorkForChoice({
            agentChoice: productAppWorkChoice(app.id),
            workspace: lastUsedWorkspace,
            rememberWorkspace,
            title: app.name,
            objective: app.goal || app.description,
          });
          return;
        }

        if (app.launch?.kind === 'appStudio') {
          await openAppStudioSession();
          return;
        }

      } catch (error) {
        notificationService.error(error instanceof Error ? error.message : tApps('productSystem.messages.launchFailed', {
          name: app.name,
          error: String(error),
        }));
      }
      return;
    }

    if (item.kind === 'workObject' && item.appId) {
      useAppsStore.getState().openAppDetail(item.appId);
      openWorkspaceScene('apps');
      return;
    }

    if (item.kind === 'component' && item.component) {
      useAppsStore.getState().openComponentCenter(item.component.id);
      openWorkspaceScene('apps');
      return;
    }

    if (item.kind === 'artifact' && item.workId) {
      if (item.artifact?.id) {
        openArtifactInCenter(item.workId, item.artifact.id);
      } else {
        openWorkInCenter(item.workId);
      }
      return;
    }

    await openMainSession(item.id, {
      workspaceId: item.workspaceId,
      activateWorkspace: item.workspaceId ? rememberWorkspace : undefined,
    });
  }, [
    lastUsedWorkspace,
    onClose,
    rememberWorkspace,
    tApps,
  ]);

  const handleInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => Math.min(index + 1, Math.max(0, results.length - 1)));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(index - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const item = results[activeIndex];
      if (item) {
        void handleSelect(item);
      }
    }
  }, [activeIndex, handleSelect, onClose, results]);

  useEffect(() => {
    const listElement = listRef.current;
    if (!listElement) return;
    const activeElement = listElement.querySelector<HTMLButtonElement>('.sparo-search-dialog__item--active');
    activeElement?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const workspaceLaunchDialog = (
    <NewWorkDialog
      open={Boolean(workspaceLaunchApp)}
      onClose={() => setWorkspaceLaunchApp(null)}
      initialAgentChoice={workspaceLaunchApp ? productAppWorkChoice(workspaceLaunchApp.id) : undefined}
      initialScopeRequirement={workspaceLaunchApp?.launch?.scopeRequirement}
    />
  );

  if (!open) return workspaceLaunchApp ? workspaceLaunchDialog : null;

  const workspaceItems = results.filter(result => result.kind === 'workspace');
  const workItems = results.filter(result => result.kind === 'work');
  const appItems = results.filter(result => result.kind === 'app');
  const workObjectItems = results.filter(result => result.kind === 'workObject');
  const componentItems = results.filter(result => result.kind === 'component');
  const artifactItems = results.filter(result => result.kind === 'artifact');
  const sessionItems = results.filter(result => result.kind === 'session');
  const queryTrimmed = query.trim();

  let globalIndex = 0;
  const renderGroup = (
    groupLabel: string,
    items: SearchResultItem[],
    renderIcon: (item: SearchResultItem) => React.ReactNode
  ) => {
    if (items.length === 0) return null;
    const startIndex = globalIndex;
    globalIndex += items.length;
    return (
      <div className="sparo-search-dialog__group" key={groupLabel}>
        <div className="sparo-search-dialog__group-label">{groupLabel}</div>
        {items.map((item, itemIndex) => {
          const itemGlobalIndex = startIndex + itemIndex;
          return (
            <SelectableRow
              key={item.id}
              className={`sparo-search-dialog__item${itemGlobalIndex === activeIndex ? ' sparo-search-dialog__item--active' : ''}`}
              data-testid="global-search-result"
              data-result-kind={item.kind}
              data-result-id={item.id}
              data-work-id={item.workId ?? ''}
              data-artifact-id={item.artifact?.id ?? ''}
              onMouseEnter={() => setActiveIndex(itemGlobalIndex)}
              onClick={() => void handleSelect(item)}
              leading={<span className="sparo-search-dialog__item-icon">{renderIcon(item)}</span>}
              title={<span className="sparo-search-dialog__item-label">{item.label}</span>}
              description={item.sublabel ? <span className="sparo-search-dialog__item-sublabel">{item.sublabel}</span> : undefined}
            />
          );
        })}
      </div>
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onClose();
        }}
        size="medium"
        showCloseButton={false}
        className="sparo-search-dialog__card"
        overlayClassName="sparo-search-dialog__overlay"
        closeOnOverlayClick
        initialFocusRef={inputRef}
        restoreFocus
      >
        <div className="sparo-search-dialog__input-row">
          <Search
            ref={inputRef}
            className="sparo-search-dialog__search"
            placeholder={t('nav.search.inputPlaceholder')}
            value={query}
            onChange={setQuery}
            onClear={() => setQuery('')}
            onKeyDown={handleInputKeyDown}
            clearable
            size="medium"
            autoFocus
          />
        </div>
        <div className="sparo-search-dialog__results" ref={listRef}>
          {results.length === 0 && queryTrimmed ? (
            <div className="sparo-search-dialog__empty">{t('nav.search.empty')}</div>
          ) : results.length === 0 ? (
            <div className="sparo-search-dialog__session-hint" role="status">
              {t('nav.search.noRecentTasks')}
            </div>
          ) : (
            <>
              {renderGroup(
                queryTrimmed ? t('nav.search.groupWorks') : t('nav.search.groupRecentWork'),
                workItems,
                () => <ListChecks size={14} />
              )}
              {renderGroup(t('nav.search.groupWorkspaces'), workspaceItems, () => <FolderOpen size={14} />)}
              {renderGroup(t('nav.search.groupApps'), appItems, () => <AppWindow size={14} />)}
              {renderGroup(t('nav.search.groupWorkObjects'), workObjectItems, () => <Layers3 size={14} />)}
              {renderGroup(t('nav.search.groupComponents'), componentItems, () => <Boxes size={14} />)}
              {renderGroup(t('nav.search.groupArtifacts'), artifactItems, () => <FileText size={14} />)}
              {renderGroup(
                queryTrimmed ? t('nav.search.groupSessions') : t('nav.search.groupRecentTasks'),
                sessionItems,
                () => <MessageSquare size={14} />
              )}
            </>
          )}
        </div>
      </Dialog>
      {workspaceLaunchDialog}
    </>
  );
};

export default GlobalSearchDialog;
