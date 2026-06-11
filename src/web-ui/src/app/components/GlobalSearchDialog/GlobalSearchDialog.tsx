import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderOpen, ListChecks, MessageSquare, Sparkles } from 'lucide-react';
import { Dialog, Search, SelectableRow, SparoAgentIcon } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { findWorkspaceForSession } from '@/flow_chat/utils/workspaceScope';
import { openMainSession } from '@/flow_chat/services/childSessionPanels';
import type { FlowChatState, Session } from '@/flow_chat/types/flow-chat';
import type { SessionMetadata } from '@/shared/types/session-history';
import type { WorkspaceInfo } from '@/shared/types';
import { sessionAPI } from '@/infrastructure/api';
import { liveAppAPI, type LiveAppMeta } from '@/infrastructure/api/service-api/LiveAppAPI';
import { APP_REGISTRY } from '@/app/scenes/apps/appRegistry';
import { resolveLiveAppMeta } from '@/app/scenes/apps/live-app/liveAppI18n';
import {
  NewWorkDialog,
  type NewWorkAgentChoice,
} from '@/app/components/WorkDock/NewWorkDialog';
import { useWorks } from '@/app/agentic-os/work/hooks/useWorks';
import { filterWorkProjections } from '@/app/agentic-os/work/data/workSelectors';
import { openWorkInCenter } from '@/app/agentic-os/work/navigation/openWork';
import type { WorkProjection } from '@/app/agentic-os/work/projections/workProjection';
import { isSystemAgenticOsSession } from '@/flow_chat/domain/sessionDescriptor';
import './GlobalSearchDialog.scss';

interface GlobalSearchDialogProps {
  open: boolean;
  onClose: () => void;
}

type SearchResultKind = 'workspace' | 'work' | 'session' | 'agent-app' | 'live-app';

interface SearchResultItem {
  kind: SearchResultKind;
  id: string;
  label: string;
  sublabel?: string;
  workspaceId?: string;
  agentChoice?: NewWorkAgentChoice;
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

type MergedSessionEntry =
  | { session: Session; workspace: WorkspaceInfo }
  | { disk: SessionMetadata; workspace: WorkspaceInfo };

/** Agentic OS（导航「Agentic OS」）会话：Dispatcher 模式，持久化�?agentic_os 命名空间�?*/
function isAgenticOsDispatcherSession(session: Session): boolean {
  return isSystemAgenticOsSession(session.descriptor);
}

function isAgenticOsDispatcherMetadata(meta: SessionMetadata): boolean {
  if (meta.agentType?.toLowerCase() === 'dispatcher') return true;
  return false;
}

function buildMergedSessionEntries(
  topLevelSessions: Array<{ session: Session; workspace: WorkspaceInfo }>,
  persistedOpenWorkspaceSessions: Array<{ meta: SessionMetadata; workspace: WorkspaceInfo }>,
  openedWorkspaceIdSet: Set<string>,
  queryTrimmed: string,
  options?: { excludeAgenticOsDispatcher?: boolean }
): MergedSessionEntry[] {
  const excludeDispatcher = options?.excludeAgenticOsDispatcher ?? false;

  let candidateTopLevel = topLevelSessions;
  if (excludeDispatcher) {
    candidateTopLevel = candidateTopLevel.filter(
      ({ session }) => !isAgenticOsDispatcherSession(session)
    );
  }

  const storeMatches = queryTrimmed
    ? candidateTopLevel.filter(({ session }) =>
        matchesQuery(queryTrimmed, getSessionTitle(session), session.sessionId)
      )
    : candidateTopLevel;
  const loadedSessionIds = new Set(storeMatches.map(({ session }) => session.sessionId));

  const diskMatches = persistedOpenWorkspaceSessions.filter(({ meta, workspace }) => {
    if (excludeDispatcher && isAgenticOsDispatcherMetadata(meta)) return false;
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

const APP_TO_AGENT_CHOICE: Record<string, NewWorkAgentChoice> = {
  'coding-app': 'agentic',
  'cowork-app': 'Cowork',
  'design-app': 'Design',
  'deep-research-app': 'DeepResearch',
  'live-app-studio-app': 'LiveAppStudio',
};

const GlobalSearchDialog: React.FC<GlobalSearchDialogProps> = ({ open, onClose }) => {
  const { t } = useI18n('common');
  const { t: tApps, currentLanguage } = useI18n('scenes/apps');
  const { openedWorkspacesList, rememberWorkspace } = useWorkspaceContext();
  const { projections } = useWorks();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [liveApps, setLiveApps] = useState<LiveAppMeta[]>([]);
  const [newWorkDialogOpen, setNewWorkDialogOpen] = useState(false);
  const [pendingAgentChoice, setPendingAgentChoice] = useState<NewWorkAgentChoice>('agentic');
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
      setLiveApps([]);
      return;
    }

    let cancelled = false;
    void liveAppAPI.listLiveApps()
      .then(items => {
        if (!cancelled) {
          setLiveApps(items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLiveApps([]);
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
        { excludeAgenticOsDispatcher: true }
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

    const filteredAgentApps = APP_REGISTRY
      .filter(app =>
        matchesQuery(trimmedQuery, app.id, tApps(app.nameKey), tApps(app.descriptionKey))
      )
      .slice(0, MAX_PER_GROUP);
    for (const app of filteredAgentApps) {
      items.push({
        kind: 'agent-app',
        id: app.id,
        label: tApps(app.nameKey),
        sublabel: tApps(app.descriptionKey),
        agentChoice: APP_TO_AGENT_CHOICE[app.id],
      });
    }

    const filteredLiveApps = liveApps
      .filter(app => {
        const displayMeta = resolveLiveAppMeta(app, currentLanguage);
        return matchesQuery(trimmedQuery, app.id, displayMeta.name, displayMeta.description, app.category, ...displayMeta.tags);
      })
      .slice(0, MAX_PER_GROUP);
    for (const app of filteredLiveApps) {
      const displayMeta = resolveLiveAppMeta(app, currentLanguage);
      items.push({
        kind: 'live-app',
        id: app.id,
        label: displayMeta.name,
        sublabel: displayMeta.description || displayMeta.tags.join(' · '),
      });
    }

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
    currentLanguage,
    liveApps,
    openedWorkspaceIdSet,
    openedWorkspacesList,
    persistedOpenWorkspaceSessions,
    projections,
    query,
    t,
    tApps,
    topLevelSessions,
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

    if (item.kind === 'agent-app') {
      const choice = item.agentChoice ?? 'agentic';
      setPendingAgentChoice(choice);
      setNewWorkDialogOpen(true);
      return;
    }

    if (item.kind === 'live-app') {
      openWorkspaceScene(`live-app:${item.id}`);
      return;
    }

    await openMainSession(item.id, {
      workspaceId: item.workspaceId,
      activateWorkspace: item.workspaceId ? rememberWorkspace : undefined,
    });
  }, [
    onClose,
    rememberWorkspace,
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

  if (!open) return null;

  const workspaceItems = results.filter(result => result.kind === 'workspace');
  const workItems = results.filter(result => result.kind === 'work');
  const agentAppItems = results.filter(result => result.kind === 'agent-app');
  const liveAppItems = results.filter(result => result.kind === 'live-app');
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
              {renderGroup(t('nav.search.groupAgentApps'), agentAppItems, () => <SparoAgentIcon size={14} />)}
              {renderGroup(t('nav.search.groupLiveApps'), liveAppItems, () => <Sparkles size={14} />)}
              {renderGroup(
                queryTrimmed ? t('nav.search.groupSessions') : t('nav.search.groupRecentTasks'),
                sessionItems,
                () => <MessageSquare size={14} />
              )}
            </>
          )}
        </div>
      </Dialog>
      <NewWorkDialog
        open={newWorkDialogOpen}
        onClose={() => setNewWorkDialogOpen(false)}
        initialAgentChoice={pendingAgentChoice}
      />
    </>
  );
};

export default GlobalSearchDialog;
