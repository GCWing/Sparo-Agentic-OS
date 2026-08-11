import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, FolderOpen } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  FloatingCard,
  IconButton,
  Input,
  Select,
  TabPane,
  Tabs,
  type SelectOption,
} from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import {
  getWorkspaceDisplayName,
  useWorkspaceContext,
} from '@/infrastructure/contexts/WorkspaceContext';
import {
  intelligentAppAPI,
  type AppSlotRecord,
} from '@/infrastructure/api/service-api/IntelligentAppAPI';
import { descriptorFromAgentType, getBackendAgentType, type SessionDescriptor } from '@/flow_chat/domain/sessionDescriptor';
import { createOsHandoffMetadata } from '@/flow_chat/domain/osHandoffIntent';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { openAgenticOsSession } from '@/flow_chat/services/openAgenticOsSession';
import { resolveSessionTypeDefinitionForDescriptor } from '@/app/session-profiles';
import { useSessionModeStore } from '@/app/stores/sessionModeStore';
import type { SessionMode } from '@/app/stores/sessionModeStore';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { openWork } from '@/app/agentic-os/work/navigation/openWork';
import type { WorkKind, WorkRecord, WorkTitleState } from '@/app/agentic-os/work/domain/workTypes';
import type { WorkAppRef } from '@/app/agentic-os/work/domain/workTypes';
import { nativeAppWorkRef } from '@/app/agentic-os/work/domain/productAppRefs';
import { launchActiveIntelligentApp } from '@/app/scenes/apps/intelligentAppLaunchService';
import type { WorkspaceInfo } from '@/shared/types';
import {
  appScopeFromWorkspaceIdentity,
  systemAppScope,
} from '@/shared/types/app-scope';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import './NewWorkDialog.scss';

const log = createLogger('NewWorkDialog');

const LS_AGENT = 'sparo.newWorkDialog.agent';
const LS_WORKSPACE = 'sparo.newWorkDialog.workspaceId';
const SYSTEM_WORKSPACE_VALUE = '__system_work__';
const BROWSED_WORKSPACE_VALUE = '__browsed_workspace__';
const INTELLIGENT_APP_CHOICE_PREFIX = 'app-slot:';
const NATIVE_AGENT_APP_IDS: Record<string, string> = {
  OSAgent: 'os-agent',
};
const BUILTIN_WORK_SLOT_IDS = ['runno', 'app-builder'] as const;
type NewWorkStartMode = 'manual' | 'agentic-os';

export type NewWorkClassifyKind = Extract<
  WorkKind,
  'multi_step' | 'topic' | 'tracking' | 'recurring'
>;

export type NewWorkAgentChoice =
  | 'OSAgent'
  | `app-slot:${string}`
  | (string & {});

export interface NewWorkDialogProps {
  open: boolean;
  onClose: () => void;
  initialAgentChoice?: NewWorkAgentChoice;
}

function appSlotWorkChoice(slotId: string): NewWorkAgentChoice {
  return `${INTELLIGENT_APP_CHOICE_PREFIX}${slotId}`;
}

// App Center keeps its original dialog/launcher interaction while the value now
// identifies a lifecycle slot instead of a mutable package installation.
export function productAppWorkChoice(slotId: string): NewWorkAgentChoice {
  return appSlotWorkChoice(slotId);
}

function parseAppSlotWorkChoice(agentChoice: NewWorkAgentChoice): string | null {
  const raw = String(agentChoice);
  if (!raw.startsWith(INTELLIGENT_APP_CHOICE_PREFIX)) return null;
  return raw.slice(INTELLIGENT_APP_CHOICE_PREFIX.length).trim() || null;
}

function normalizeChoiceForAvailableApps(
  agentChoice: NewWorkAgentChoice | null | undefined,
  availableChoices: Set<string>,
): NewWorkAgentChoice | null {
  if (!agentChoice) return null;
  return availableChoices.has(String(agentChoice)) ? agentChoice : null;
}

function labelForChoice(agentChoice: NewWorkAgentChoice): string {
  const slotId = parseAppSlotWorkChoice(agentChoice);
  if (slotId) return `${slotId} Work`;
  switch (agentChoice) {
    case 'OSAgent':
      return 'OS Work';
    default:
      return `${agentChoice} Work`;
  }
}

function pickDefaultWorkspaceId(
  opened: WorkspaceInfo[],
  recent: WorkspaceInfo[],
  current: WorkspaceInfo | null,
  storedId: string | null
): string | null {
  if (storedId === SYSTEM_WORKSPACE_VALUE) {
    return SYSTEM_WORKSPACE_VALUE;
  }
  if (storedId && opened.some((workspace) => workspace.id === storedId)) {
    return storedId;
  }
  for (const recentWorkspace of recent) {
    if (opened.some((workspace) => workspace.id === recentWorkspace.id)) {
      return recentWorkspace.id;
    }
  }
  if (current && opened.some((workspace) => workspace.id === current.id)) {
    return current.id;
  }
  return opened[0]?.id ?? SYSTEM_WORKSPACE_VALUE;
}

function normalizeWorkspacePath(path: string): string {
  return path.trim().replace(/\\/g, '/');
}

function findOpenedWorkspaceByPath(openedWorkspaces: WorkspaceInfo[], path: string): WorkspaceInfo | undefined {
  const normalizedPath = normalizeWorkspacePath(path);
  return openedWorkspaces.find((workspace) => normalizeWorkspacePath(workspace.rootPath) === normalizedPath);
}

function getBrowsedWorkspaceName(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] || path;
}

function resolveDescriptorFromChoice(agentChoice: NewWorkAgentChoice): SessionDescriptor {
  return descriptorFromAgentType(agentChoice);
}

function syncSessionModeStore(descriptor: SessionDescriptor): void {
  const displayMode = resolveSessionTypeDefinitionForDescriptor(descriptor).lifecycle.displayMode;
  useSessionModeStore.getState().setMode(displayMode as SessionMode);
}

// Re-exported for other modules; HMR is fine without fast-refresh for this non-component.
// eslint-disable-next-line react-refresh/only-export-components
export async function launchWorkForChoice(params: {
  agentChoice: NewWorkAgentChoice;
  workspace: WorkspaceInfo | null;
  rememberWorkspace: (workspaceId: string) => Promise<WorkspaceInfo>;
  title?: string;
  objective?: string;
  titleState?: WorkTitleState | null;
  classifyKind?: NewWorkClassifyKind;
  appRef?: WorkAppRef;
  workResolutionMode?: string;
}): Promise<WorkRecord> {
  const {
    agentChoice,
    workspace,
    rememberWorkspace,
    title,
    objective,
    titleState,
    classifyKind = 'multi_step',
  } = params;
  const resolvedAgentChoice = agentChoice;
  const nativeAppId = NATIVE_AGENT_APP_IDS[String(agentChoice)];
  const resolvedAppRef = params.appRef ?? (nativeAppId ? nativeAppWorkRef(nativeAppId) : undefined);
  const resolvedTitle = title?.trim();
  const resolvedObjective = objective?.trim();
  const resolvedWorkScope = workspace
    ? { kind: 'workspace' as const, workspaceId: workspace.id }
    : { kind: 'global' as const };

  const descriptor = resolveDescriptorFromChoice(resolvedAgentChoice);
  const backendAgentType = getBackendAgentType(descriptor);
  const defaultTitle = labelForChoice(resolvedAgentChoice);
  const workTitle = resolvedTitle || defaultTitle;
  const workObjective = resolvedObjective || defaultTitle;
  const appRefs = resolvedAppRef ? [{ app: resolvedAppRef, role: 'executor' as const }] : [];

  syncSessionModeStore(descriptor);

  const work = await useWorkStore.getState().createWork({
    kind: classifyKind,
    title: workTitle,
    objective: workObjective,
    subject: resolvedAppRef
      ? { kind: 'app', app: resolvedAppRef, intent: 'run' }
      : { kind: 'goal' },
    appRefs,
    scope: resolvedWorkScope,
    workspacePath: workspace?.rootPath,
    visibility: 'primary',
    primarySurfacePolicy: 'work_session',
    titleState: titleState ?? { source: 'template', locked: false },
    assignment: {
      kind: 'agent',
      agentType: backendAgentType,
    },
  });

  if (workspace) {
    await rememberWorkspace(workspace.id);
  }
  await openWork(work);
  return work;
}

export const NewWorkDialog: React.FC<NewWorkDialogProps> = ({
  open: isOpen,
  onClose,
  initialAgentChoice,
}) => {
  const { t } = useI18n('common');
  const {
    openedWorkspacesList,
    recentWorkspaces,
    lastUsedWorkspace,
    rememberWorkspace,
    openWorkspace,
  } = useWorkspaceContext();

  const [agentChoice, setAgentChoice] = useState<NewWorkAgentChoice>(appSlotWorkChoice('runno'));
  const [startMode, setStartMode] = useState<NewWorkStartMode>('manual');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [browsedWorkspacePath, setBrowsedWorkspacePath] = useState<string | null>(null);
  const [objective, setObjective] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [appSlots, setAppSlots] = useState<AppSlotRecord[]>([]);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const knownBuiltinChoices = useMemo<Set<string>>(
    () => new Set(BUILTIN_WORK_SLOT_IDS.map(appSlotWorkChoice)),
    []
  );

  const intelligentExecutors = useMemo(() => appSlots.flatMap((slot) => {
    const activeApp = intelligentAppAPI.activeRef(slot);
    if (!activeApp?.runtime.launch) return [];
    const variant = slot.variants.find(({ app }) => app.appId === activeApp.appId);
    return [{
      choice: appSlotWorkChoice(slot.slotId),
      slot,
      activeApp,
      description: variant?.app.description ?? '',
    }];
  }), [appSlots]);
  const executorByChoice = useMemo(
    () => new Map(intelligentExecutors.map((executor) => [executor.choice, executor])),
    [intelligentExecutors],
  );
  const selectedExecutor = executorByChoice.get(agentChoice);

  const resetDefaults = useCallback(() => {
    let storedAgent: NewWorkAgentChoice | null = null;
    let storedWorkspaceId: string | null = null;
    try {
      const rawAgent = localStorage.getItem(LS_AGENT) as NewWorkAgentChoice | null;
      storedAgent = rawAgent;
      storedWorkspaceId = localStorage.getItem(LS_WORKSPACE);
    } catch {
      /* ignore */
    }

    setAgentChoice(initialAgentChoice ?? storedAgent ?? appSlotWorkChoice('runno'));
    setStartMode('manual');
    setBrowsedWorkspacePath(null);
    setObjective('');
    setWorkspaceId(
      pickDefaultWorkspaceId(openedWorkspacesList, recentWorkspaces, lastUsedWorkspace, storedWorkspaceId)
    );
  }, [
    initialAgentChoice,
    lastUsedWorkspace,
    openedWorkspacesList,
    recentWorkspaces,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    resetDefaults();
  }, [isOpen, resetDefaults]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusFrame = window.requestAnimationFrame(() => cardRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setAppSlots([]);
    intelligentAppAPI.listCatalog().then((catalog) => {
      if (cancelled) return;
      setAppSlots(catalog.slots);
      const available = new Set<string>();
      for (const slot of catalog.slots) {
        if (intelligentAppAPI.activeRef(slot)?.runtime.launch) {
          available.add(appSlotWorkChoice(slot.slotId));
        }
      }
      const fallbackChoice = BUILTIN_WORK_SLOT_IDS
        .map(appSlotWorkChoice)
        .find((choice) => available.has(choice))
        ?? (available.values().next().value as NewWorkAgentChoice | undefined)
        ?? appSlotWorkChoice('runno');
      setAgentChoice((current) => normalizeChoiceForAvailableApps(current, available) ?? fallbackChoice);
    }).catch((error) => {
      if (cancelled) return;
      log.error('Failed to load active Intelligent App executors', { error });
      setAppSlots([]);
      setAgentChoice(appSlotWorkChoice('runno'));
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const workspaceOptions = useMemo<SelectOption[]>(() => {
    const recentOrder = new Map(recentWorkspaces.map((workspace, index) => [workspace.id, index]));
    const sorted = [...openedWorkspacesList].sort((left, right) => {
      const leftOrder = recentOrder.get(left.id) ?? 9999;
      const rightOrder = recentOrder.get(right.id) ?? 9999;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return getWorkspaceDisplayName(left).localeCompare(getWorkspaceDisplayName(right));
    });
    const workspaceItems = sorted.map((workspace) => ({
      label: getWorkspaceDisplayName(workspace),
      value: workspace.id,
      description: workspace.rootPath,
    }));
    const options: SelectOption[] = [
      {
        label: t('nav.workDock.globalScopeLabel'),
        value: SYSTEM_WORKSPACE_VALUE,
        description: t('nav.workDock.globalScopeDescription'),
      },
      ...workspaceItems,
    ];
    if (browsedWorkspacePath) {
      options.splice(1, 0, {
        label: getBrowsedWorkspaceName(browsedWorkspacePath),
        value: BROWSED_WORKSPACE_VALUE,
        description: browsedWorkspacePath,
      });
    }
    return options;
  }, [browsedWorkspacePath, openedWorkspacesList, recentWorkspaces, t]);

  const agentOptions = useMemo<SelectOption[]>(
    () => {
      const optionForExecutor = (executor: (typeof intelligentExecutors)[number], group: string) => ({
        value: executor.choice,
        label: executor.slot.displayName,
        description: executor.description,
        group,
      });
      const builtinOptions = BUILTIN_WORK_SLOT_IDS.flatMap((slotId) => {
        const executor = intelligentExecutors.find((candidate) => candidate.slot.slotId === slotId);
        return executor
          ? [optionForExecutor(executor, t('nav.workDock.executor.systemGroup'))]
          : [];
      });
      const appOptions = intelligentExecutors
        .filter((executor) => !knownBuiltinChoices.has(executor.choice))
        .map((executor) => optionForExecutor(executor, t('nav.workDock.executor.intelligentAppGroup')));
      return [...builtinOptions, ...appOptions];
    },
    [intelligentExecutors, knownBuiltinChoices, t]
  );

  const renderAgentOption = useCallback((option: SelectOption) => (
    <div className="new-work-dialog__agent-option">
      <span className="new-work-dialog__agent-option-main">
        <span className="new-work-dialog__agent-option-label">{option.label}</span>
        {knownBuiltinChoices.has(String(option.value)) && (
          <span className="new-work-dialog__system-badge">{t('nav.workDock.executor.systemBadge')}</span>
        )}
      </span>
      {option.description && (
        <span className="new-work-dialog__agent-option-description" title={option.description}>
          {option.description}
        </span>
      )}
    </div>
  ), [knownBuiltinChoices, t]);

  const renderAgentValue = useCallback((option?: SelectOption | SelectOption[]) => {
    if (!option || Array.isArray(option)) return null;
    return (
      <div className="new-work-dialog__agent-option new-work-dialog__agent-option--value">
        <span className="new-work-dialog__agent-option-main">
          <span className="new-work-dialog__agent-option-label">{option.label}</span>
        </span>
      </div>
    );
  }, []);

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('header.selectProjectDirectory'),
      });
      if (selected && typeof selected === 'string') {
        const openedWorkspace = findOpenedWorkspaceByPath(openedWorkspacesList, selected);
        if (openedWorkspace) {
          setBrowsedWorkspacePath(null);
          setWorkspaceId(openedWorkspace.id);
          return;
        }

        setBrowsedWorkspacePath(selected);
        setWorkspaceId(BROWSED_WORKSPACE_VALUE);
      }
    } catch (error) {
      log.error('Browse workspace failed', { error });
      notificationService.error(
        error instanceof Error ? error.message : t('nav.workDock.browseWorkspaceFailed'),
        { duration: 3000 }
      );
    }
  }, [openedWorkspacesList, t]);

  const handleConfirm = useCallback(async () => {
    const trimmedObjective = objective.trim();
    if (startMode === 'agentic-os' && !trimmedObjective) {
      notificationService.error(t('nav.workDock.objectiveRequired'), { duration: 3000 });
      return;
    }
    if (startMode === 'manual' && parseAppSlotWorkChoice(agentChoice) && !selectedExecutor) {
      notificationService.error(t('nav.workDock.executor.releaseUnavailable'), { duration: 3000 });
      return;
    }
    setSubmitting(true);
    try {
      if (startMode === 'agentic-os') {
        const agenticOsSessionId = await openAgenticOsSession();
        if (!agenticOsSessionId) {
          throw new Error('Failed to open Agentic OS session');
        }
        await flowChatManager.sendMessage(
          trimmedObjective,
          agenticOsSessionId,
          trimmedObjective,
          'OSAgent',
          undefined,
          {
            metadata: createOsHandoffMetadata(trimmedObjective),
            systemReminderOverride: [
              'The user chose Delegate to OS from the Work creation entry point.',
              'Decide whether this should become durable Work.',
              'If it should become managed work, call the Work tool.',
              'If it is better handled as dialog, answer normally.',
              'Do not claim a Work exists unless the Work tool succeeds.',
            ].join(' '),
          }
        );
        onClose();
        return;
      }

      let workspace = workspaceId === SYSTEM_WORKSPACE_VALUE
        ? null
        : openedWorkspacesList.find((item) => item.id === workspaceId) ?? null;
      const shouldOpenBrowsedWorkspace = workspaceId === BROWSED_WORKSPACE_VALUE && !!browsedWorkspacePath;

      if (!workspace && shouldOpenBrowsedWorkspace && browsedWorkspacePath) {
        workspace = await openWorkspace(browsedWorkspacePath);
      }
      if (selectedExecutor) {
        const scope = workspace
          ? appScopeFromWorkspaceIdentity({
              workspaceId: workspace.id,
              workspacePath: workspace.rootPath,
              workspaceName: workspace.name,
            })
          : systemAppScope();
        await launchActiveIntelligentApp(selectedExecutor.activeApp, {
          scope,
          title: selectedExecutor.slot.displayName,
          objective: selectedExecutor.description || selectedExecutor.slot.displayName,
          intent: { kind: 'create_new' },
        });
        if (workspace) await rememberWorkspace(workspace.id);
      } else {
        await launchWorkForChoice({
          agentChoice,
          workspace,
          rememberWorkspace,
        });
      }

      try {
        localStorage.setItem(LS_AGENT, agentChoice);
        if (workspace) {
          localStorage.setItem(LS_WORKSPACE, workspace.id);
        } else if (workspaceId === SYSTEM_WORKSPACE_VALUE) {
          localStorage.setItem(LS_WORKSPACE, SYSTEM_WORKSPACE_VALUE);
        }
      } catch {
        /* ignore */
      }

      onClose();
    } catch (error) {
      log.error('Create work from dialog failed', { error });
      notificationService.error(
        error instanceof Error
          ? error.message
          : startMode === 'agentic-os'
            ? t('nav.workDock.dispatchFailed')
            : t('nav.workDock.createFailed'),
        { duration: 4000 }
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    agentChoice,
    browsedWorkspacePath,
    objective,
    onClose,
    openWorkspace,
    openedWorkspacesList,
    rememberWorkspace,
    selectedExecutor,
    startMode,
    t,
    workspaceId,
  ]);

  const canSubmit = (startMode === 'manual' || objective.trim().length > 0)
    && (startMode === 'agentic-os' || !parseAppSlotWorkChoice(agentChoice) || Boolean(selectedExecutor))
    && !submitting;

  const renderActions = () => {
    const confirmLabel = startMode === 'agentic-os'
      ? t('nav.workDock.confirmDispatch')
      : t('nav.workDock.confirmCreate');

    return (
      <footer className="new-work-dialog__actions">
        <IconButton
          type="button"
          variant="primary"
          size="medium"
          isLoading={submitting}
          onClick={() => void handleConfirm()}
          disabled={!canSubmit}
          aria-label={confirmLabel}
          tooltip={confirmLabel}
          tooltipPlacement="top"
          data-testid="new-work-confirm"
        >
          <ArrowRight size={18} aria-hidden />
        </IconButton>
      </footer>
    );
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="new-work-dialog-layer">
      <FloatingCard
        ref={cardRef}
        className="new-work-dialog"
        padding="default"
        onDismiss={onClose}
        dismissLabel={t('actions.close')}
        dismissTooltip={t('actions.close')}
        role="dialog"
        aria-modal="false"
        aria-labelledby="new-work-dialog-title"
        aria-describedby="new-work-dialog-hint"
        tabIndex={-1}
        data-testid="new-work-dialog"
      >
        <h2 className="new-work-dialog__title" id="new-work-dialog-title">
          {t('nav.workDock.createTitle')}
        </h2>

        <Tabs
          className="new-work-dialog__tabs"
          type="line"
          size="medium"
          activeKey={startMode}
          onChange={(value) => setStartMode(value as NewWorkStartMode)}
        >
          <TabPane tabKey="manual" label={t('nav.workDock.modeManual')}>
            <section className="new-work-dialog__stage">
              <p className="new-work-dialog__hint" id="new-work-dialog-hint">
                {t('nav.workDock.definitionHint')}
              </p>
              <div className="new-work-dialog__sentence" key="manual">
                <span className="new-work-dialog__sentence-copy">{t('nav.workDock.sentencePrefix')}</span>
                <div className="new-work-dialog__agent-select">
                  <Select
                    id="new-work-agent-select"
                    size="medium"
                    shape="pill"
                    options={agentOptions}
                    value={agentChoice}
                    onChange={(value) => setAgentChoice(value as NewWorkAgentChoice)}
                    renderOption={renderAgentOption}
                    renderValue={renderAgentValue}
                    dropdownWidth="min(360px, calc(100vw - 32px))"
                    searchPlaceholder={t('nav.workDock.agentSearchPlaceholder')}
                    searchable
                  />
                </div>
                <span className="new-work-dialog__sentence-copy">{t('nav.workDock.sentenceInfix')}</span>
                <div className="new-work-dialog__workspace-field">
                  <div className="new-work-dialog__workspace-select">
                    <Select
                      id="new-work-workspace-select"
                      size="medium"
                      shape="pill"
                      options={workspaceOptions}
                      value={workspaceId ?? ''}
                      onChange={(value) => {
                        const selectedValue = String(value);
                        setWorkspaceId(selectedValue);
                        if (selectedValue !== BROWSED_WORKSPACE_VALUE) {
                          setBrowsedWorkspacePath(null);
                        }
                      }}
                      placeholder={t('nav.workDock.workspacePlaceholder')}
                      searchable
                      dropdownWidth="min(420px, calc(100vw - 32px))"
                      dropdownAlign="end"
                      emptyText={t('nav.workDock.noOpenWorkspace')}
                    />
                  </div>
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="medium"
                    className="new-work-dialog__browse"
                    onClick={() => void handleBrowse()}
                    aria-label={t('nav.workDock.browseWorkspace')}
                    tooltip={t('nav.workDock.browseWorkspace')}
                    tooltipPlacement="top"
                  >
                    <FolderOpen size={16} aria-hidden />
                  </IconButton>
                </div>
                <span className="new-work-dialog__sentence-copy">{t('nav.workDock.sentenceSuffix')}</span>
              </div>
              {renderActions()}
            </section>
          </TabPane>

          <TabPane tabKey="agentic-os" label={t('nav.workDock.modeAgenticOs')}>
            <section className="new-work-dialog__stage">
              <p className="new-work-dialog__hint" id="new-work-dialog-hint">
                {t('nav.workDock.definitionHint')}
              </p>
              <div className="new-work-dialog__sentence new-work-dialog__sentence--delegate" key="agentic-os">
                <span className="new-work-dialog__sentence-copy">{t('nav.workDock.delegatePrefix')}</span>
                <Input
                  className="new-work-dialog__objective"
                  value={objective}
                  onChange={(event) => setObjective(event.target.value)}
                  placeholder={t('nav.workDock.objectivePlaceholder')}
                  size="medium"
                  shape="pill"
                  focusTone="danger"
                  maxLength={600}
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canSubmit) void handleConfirm();
                  }}
                />
                <span className="new-work-dialog__sentence-copy">{t('nav.workDock.delegateSuffix')}</span>
              </div>
              {renderActions()}
            </section>
          </TabPane>
        </Tabs>
      </FloatingCard>
    </div>,
    document.body,
  );
};
