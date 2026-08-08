import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow,
  FileText,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Plus,
} from 'lucide-react';
import { Dialog, IconButton, Search, SelectableRow } from '@/design-system';
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
  intelligentAppAPI,
  type AppSlotRecord,
} from '@/infrastructure/api/service-api/IntelligentAppAPI';
import { NewWorkDialog } from '@/app/components/WorkDock/NewWorkDialog';
import { useWorks } from '@/app/agentic-os/work/hooks/useWorks';
import { filterWorkProjections } from '@/app/agentic-os/work/data/workSelectors';
import { openArtifactInCenter, openWorkCenterHome, openWorkInCenter } from '@/app/agentic-os/work/navigation/openWork';
import type { WorkProjection } from '@/app/agentic-os/work/projections/workProjection';
import { WorkIcon } from '@/app/agentic-os/work/presentation/WorkIcon';
import { isSystemAgenticOsSession } from '@/flow_chat/domain/sessionDescriptor';
import { notificationService } from '@/shared/notification-system';
import { launchActiveIntelligentApp } from '@/app/scenes/apps/intelligentAppLaunchService';
import { systemAppScope } from '@/shared/types/app-scope';
import type { ArtifactRef, WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import {
  getWorkToneValue,
  isInstrumentedStatus,
  selectWorksForDockList,
  statusKey,
  WORK_DOCK_LIST_LIMIT,
} from '@/app/components/WorkList/workListSelection';
import './GlobalSearchDialog.scss';

interface GlobalSearchDialogProps {
  open: boolean;
  onClose: () => void;
}

type SearchResultKind = 'workspace' | 'work' | 'session' | 'app' | 'artifact';

interface SearchResultItem {
  kind: SearchResultKind;
  id: string;
  label: string;
  sublabel?: string;
  workspaceId?: string;
  workId?: string;
  work?: WorkProjection;
  appId?: string;
  appSlot?: AppSlotRecord;
  artifact?: ArtifactRef;
}

const MAX_PER_GROUP = 20;

const getSessionTitle = (session: Session): string =>
  session.title?.trim() || `Task ${session.sessionId.slice(0, 6)}`;

const getSessionRecencyTime = (session: Session): number =>
  session.updatedAt ?? session.lastActiveAt ?? session.createdAt ?? 0;

const matchesQuery = (query: string, ...fields: (string | undefined | null)[]): boolean => {
  const normalizedQuery = query.toLowerCase();
  return fields.some(field => field && field.toLowerCase().includes(normalizedQuery));
};

function matchesAppSlot(query: string, slot: AppSlotRecord): boolean {
  return matchesQuery(
    query,
    slot.slotId,
    slot.displayName,
    ...slot.variants.flatMap(({ app }) => [app.appId, app.displayName, app.description]),
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
    work,
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
  const { openedWorkspacesList, rememberWorkspace } = useWorkspaceContext();
  const { works, projections } = useWorks();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [appSlots, setAppSlots] = useState<AppSlotRecord[]>([]);
  const [newWorkDialogOpen, setNewWorkDialogOpen] = useState(false);
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
          const sessionList = await sessionAPI.listSessions({
            kind: 'workspace',
            workspace_id: workspace.id,
          });
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
      setAppSlots([]);
      return;
    }

    let cancelled = false;
    void intelligentAppAPI.listCatalog()
      .then((catalog) => {
        if (!cancelled) {
          setAppSlots(catalog.slots.filter((slot) => intelligentAppAPI.activeRef(slot)));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppSlots([]);
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
      : selectWorksForDockList(projections, {
          maxWorks: WORK_DOCK_LIST_LIMIT,
          includeCompleted: false,
        });
    const matchedWorkSessionIds = new Set(
      matchedWorks
        .map(work => work.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId))
    );

    for (const work of matchedWorks) {
      items.push(buildWorkResult(work, openedWorkspacesList, t));
    }

    if (!trimmedQuery) {
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

    const filteredAppSlots = appSlots
      .filter(slot => matchesAppSlot(trimmedQuery, slot))
      .slice(0, MAX_PER_GROUP);
    for (const slot of filteredAppSlots) {
      const active = intelligentAppAPI.activeRef(slot);
      const activeVariant = slot.variants.find(({ app }) => app.appId === active?.appId);
      items.push({
        kind: 'app',
        id: slot.slotId,
        label: slot.displayName,
        sublabel: activeVariant?.app.description ?? activeVariant?.app.displayName,
        appId: active?.appId,
        appSlot: slot,
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
    appSlots,
    openedWorkspaceIdSet,
    openedWorkspacesList,
    persistedOpenWorkspaceSessions,
    projections,
    query,
    t,
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

    if (item.kind === 'app' && item.appSlot) {
      const active = intelligentAppAPI.activeRef(item.appSlot);
      if (!active) return;
      const variant = item.appSlot.variants.find(({ app }) => app.appId === active.appId);
      try {
        await launchActiveIntelligentApp(active, {
          scope: systemAppScope(),
          title: item.appSlot.displayName,
          objective: variant?.app.description || item.appSlot.displayName,
          intent: { kind: 'resume_last' },
        });
      } catch (error) {
        notificationService.error(error instanceof Error ? error.message : String(error));
      }
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
    onClose,
    rememberWorkspace,
  ]);

  const handleOpenWorkCenter = useCallback(() => {
    onClose();
    openWorkCenterHome();
  }, [onClose]);

  const handleCreateWork = useCallback(() => {
    setNewWorkDialogOpen(true);
    onClose();
  }, [onClose]);

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

  const newWorkDialog = (
    <NewWorkDialog
      open={newWorkDialogOpen}
      onClose={() => setNewWorkDialogOpen(false)}
    />
  );

  if (!open) {
    return (
      <>
        {newWorkDialogOpen ? newWorkDialog : null}
      </>
    );
  }

  const workspaceItems = results.filter(result => result.kind === 'workspace');
  const workItems = results.filter(result => result.kind === 'work');
  const appItems = results.filter(result => result.kind === 'app');
  const artifactItems = results.filter(result => result.kind === 'artifact');
  const sessionItems = results.filter(result => result.kind === 'session');
  const queryTrimmed = query.trim();

  const renderWorkIcon = (item: SearchResultItem) => {
    if (!item.work) return <ListChecks size={14} />;
    const instrumented = isInstrumentedStatus(item.work.status);
    return (
      <span
        className={[
          'sparo-search-dialog__work-mode-icon',
          `sparo-search-dialog__work-mode-icon--${statusKey(item.work.status)}`,
          instrumented && 'has-state-instrument',
        ].filter(Boolean).join(' ')}
        style={{ '--sparo-search-dialog-work-tone': getWorkToneValue(item.work.status) } as React.CSSProperties}
      >
        <span className="sparo-search-dialog__work-mode-glyph">
          <WorkIcon work={item.work} size={18} />
        </span>
        {instrumented ? <span className="sparo-search-dialog__work-state-mark" /> : null}
      </span>
    );
  };

  let globalIndex = 0;
  const renderGroup = (
    groupLabel: string,
    items: SearchResultItem[],
    renderIcon: (item: SearchResultItem) => React.ReactNode,
    headerActions?: React.ReactNode
  ) => {
    if (items.length === 0) return null;
    const startIndex = globalIndex;
    globalIndex += items.length;
    return (
      <div className="sparo-search-dialog__group" key={groupLabel}>
        <div className="sparo-search-dialog__group-header">
          <div className="sparo-search-dialog__group-label">{groupLabel}</div>
          {headerActions ? (
            <div className="sparo-search-dialog__group-actions">
              {headerActions}
            </div>
          ) : null}
        </div>
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
                renderWorkIcon,
                !queryTrimmed ? (
                  <>
                    <IconButton
                      size="xs"
                      variant="ghost"
                      className="sparo-search-dialog__group-action"
                      aria-label={t('nav.workDock.openWorkCenter')}
                      tooltip={t('nav.workDock.openWorkCenter')}
                      tooltipPlacement="top"
                      onClick={handleOpenWorkCenter}
                      data-testid="global-search-open-work-center"
                    >
                      <LayoutDashboard size={13} strokeWidth={2.25} />
                    </IconButton>
                    <IconButton
                      size="xs"
                      variant="ghost"
                      className="sparo-search-dialog__group-action"
                      aria-label={t('nav.workDock.newWorkButton')}
                      tooltip={t('nav.workDock.newWorkButton')}
                      tooltipPlacement="top"
                      onClick={handleCreateWork}
                      data-testid="global-search-new-work"
                    >
                      <Plus size={13} strokeWidth={2.25} />
                    </IconButton>
                  </>
                ) : undefined
              )}
              {renderGroup(t('nav.search.groupWorkspaces'), workspaceItems, () => <FolderOpen size={14} />)}
              {renderGroup(t('nav.search.groupApps'), appItems, () => <AppWindow size={14} />)}
              {renderGroup(t('nav.search.groupArtifacts'), artifactItems, () => <FileText size={14} />)}
              {queryTrimmed ? renderGroup(
                t('nav.search.groupSessions'),
                sessionItems,
                () => <MessageSquare size={14} />
              ) : null}
            </>
          )}
        </div>
      </Dialog>
      {newWorkDialog}
    </>
  );
};

export default GlobalSearchDialog;
