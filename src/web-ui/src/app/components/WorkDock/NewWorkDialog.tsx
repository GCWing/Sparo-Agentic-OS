import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { Button, Dialog, IconButton, Select, Textarea, type SelectOption } from '@/design-system';
import { useI18n } from '@/infrastructure/i18n';
import {
  getWorkspaceDisplayName,
  useWorkspaceContext,
} from '@/infrastructure/contexts/WorkspaceContext';
import {
  appCatalogAPI,
  type ProductAppCatalogEntry,
  type ProductAppLaunchScopeRequirement,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import {
  getProductAppLaunchScopeRequirement,
  productAppSupportsMultipleWorks,
  resolveProductAppWorkScope,
} from '@/app/agentic-os/work/domain/productAppLaunchPolicy';
import { descriptorFromAgentType, getBackendAgentType, type SessionDescriptor } from '@/flow_chat/domain/sessionDescriptor';
import { createOsHandoffMetadata } from '@/flow_chat/domain/osHandoffIntent';
import { flowChatManager } from '@/flow_chat/services/FlowChatManager';
import { openAgenticOsSession } from '@/flow_chat/services/openAgenticOsSession';
import { resolveSessionTypeDefinitionForDescriptor } from '@/app/session-profiles';
import { useSessionModeStore } from '@/app/stores/sessionModeStore';
import type { SessionMode } from '@/app/stores/sessionModeStore';
import { useWorkStore } from '@/app/agentic-os/work/data/workStore';
import { openWork } from '@/app/agentic-os/work/navigation/openWork';
import type { WorkAppRef, WorkRecord } from '@/app/agentic-os/work/domain/workTypes';
import { productAppWorkRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type { WorkspaceInfo } from '@/shared/types';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import './NewWorkDialog.scss';

const log = createLogger('NewWorkDialog');

const LS_AGENT = 'sparo.newWorkDialog.agent';
const LS_WORKSPACE = 'sparo.newWorkDialog.workspaceId';
const SYSTEM_WORKSPACE_VALUE = '__system_work__';
const BROWSED_WORKSPACE_VALUE = '__browsed_workspace__';
const PRODUCT_APP_CHOICE_PREFIX = 'product-app:';
const LEGACY_AGENT_PRODUCT_APP_IDS: Record<string, string> = {
  agentic: 'builtin-coding',
  Cowork: 'builtin-cowork',
  Design: 'builtin-design',
  DeepResearch: 'builtin-deep-research',
};

type NewWorkStartMode = 'manual' | 'agentic-os';

export type NewWorkAgentChoice =
  | 'agentic'
  | 'Cowork'
  | 'Design'
  | 'DeepResearch'
  | (string & {});

export interface NewWorkDialogProps {
  open: boolean;
  onClose: () => void;
  initialAgentChoice?: NewWorkAgentChoice;
  initialScopeRequirement?: ProductAppLaunchScopeRequirement;
}

export function productAppWorkChoice(appId: string): NewWorkAgentChoice {
  return `${PRODUCT_APP_CHOICE_PREFIX}${appId}` as NewWorkAgentChoice;
}

function parseProductAppWorkChoice(agentChoice: NewWorkAgentChoice): string | null {
  const raw = String(agentChoice);
  if (!raw.startsWith(PRODUCT_APP_CHOICE_PREFIX)) return null;
  const appId = raw.slice(PRODUCT_APP_CHOICE_PREFIX.length).trim();
  return appId || null;
}

function normalizeChoiceForAvailableApps(
  agentChoice: NewWorkAgentChoice | null | undefined,
  apps: ProductAppCatalogEntry[],
  knownBuiltinChoices: Set<string>,
): NewWorkAgentChoice | null {
  if (!agentChoice) return null;
  const productAppId = parseProductAppWorkChoice(agentChoice);
  if (productAppId) {
    return apps.some((app) => app.id === productAppId) ? agentChoice : null;
  }

  if (apps.length > 0) {
    const mappedAppId = LEGACY_AGENT_PRODUCT_APP_IDS[String(agentChoice)];
    return mappedAppId && apps.some((app) => app.id === mappedAppId)
      ? productAppWorkChoice(mappedAppId)
      : null;
  }

  return knownBuiltinChoices.has(String(agentChoice)) ? agentChoice : null;
}

function defaultProductAppChoice(apps: ProductAppCatalogEntry[]): NewWorkAgentChoice | null {
  const preferred =
    apps.find((app) => app.id === 'builtin-coding') ??
    apps.find((app) => app.launch?.kind === 'agentSession') ??
    apps[0];
  return preferred ? productAppWorkChoice(preferred.id) : null;
}

function labelForChoice(agentChoice: NewWorkAgentChoice): string {
  const productAppId = parseProductAppWorkChoice(agentChoice);
  if (productAppId) {
    return `${productAppId} Work`;
  }

  switch (agentChoice) {
    case 'agentic':
      return 'Code Work';
    case 'Cowork':
      return 'Cowork Work';
    case 'Design':
      return 'Design Work';
    case 'DeepResearch':
      return 'Research Work';
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
  const sessionMode: SessionMode =
    displayMode === 'cowork' ||
    displayMode === 'design' ||
    displayMode === 'appstudio' ||
    displayMode === 'componentstudio'
      ? displayMode
      : 'code';
  useSessionModeStore.getState().setMode(sessionMode);
}

// Re-exported for other modules; HMR is fine without fast-refresh for this non-component.
// eslint-disable-next-line react-refresh/only-export-components
export async function launchWorkForChoice(params: {
  agentChoice: NewWorkAgentChoice;
  workspace: WorkspaceInfo | null;
  rememberWorkspace: (workspaceId: string) => Promise<WorkspaceInfo>;
  title?: string;
  objective?: string;
  appRef?: WorkAppRef;
}): Promise<WorkRecord> {
  const { agentChoice, workspace, rememberWorkspace, title, objective, appRef } = params;
  const productAppId = parseProductAppWorkChoice(agentChoice);
  let resolvedAgentChoice = agentChoice;
  let resolvedAppRef = appRef;
  let resolvedTitle = title?.trim();
  let resolvedObjective = objective?.trim();
  let resolvedWorkScope = workspace
    ? { kind: 'workspace' as const, workspacePath: workspace.rootPath }
    : { kind: 'system' as const };

  if (productAppId) {
    const productApp = await appCatalogAPI.getProductApp(productAppId);
    const productAppRef = productAppWorkRef(productApp);
    const launch = productApp.launch;
    resolvedAppRef = productAppRef;
    resolvedTitle = resolvedTitle || productApp.name;
    resolvedObjective = resolvedObjective || productApp.goal || productApp.description || productApp.name;

    if (!launch) {
      throw new Error(`Product App ${productApp.name} has no launch target.`);
    }
    resolvedWorkScope = resolveProductAppWorkScope(productApp, workspace);

    if (launch.kind === 'applicationSurface') {
      const targetProductAppId = productApp.id;
      const targetSurfaceComponentId = productApp.primarySurface.componentId;
      const targetSurfaceId = launch.surfaceId || productApp.primarySurface.surfaceId || 'primary';
      const primarySurface = {
        kind: 'application_surface' as const,
        productAppId: targetProductAppId,
        surfaceComponentId: targetSurfaceComponentId,
        surfaceId: targetSurfaceId,
      };
      const appRefs = [
        { app: productAppRef, role: 'executor' as const },
      ];
      const assignment = {
        kind: 'application' as const,
        applicationId: targetProductAppId,
      };
      const workStore = useWorkStore.getState();

      const work = productAppSupportsMultipleWorks(productApp)
        ? await workStore.createWork({
            kind: 'app_workflow',
            title: resolvedTitle,
            objective: resolvedObjective,
            subject: {
              kind: 'app',
              app: productAppRef,
              intent: 'run',
            },
            appRefs,
            scope: resolvedWorkScope,
            visibility: 'primary',
            primarySurfacePolicy: 'application_surface',
            primarySurface,
            titleState: title?.trim()
              ? { source: 'user', locked: true }
              : { source: 'application_surface', locked: false, subjectRef: targetProductAppId },
            assignment,
          })
        : (await workStore.resolveAppWork({
            app: productAppRef,
            intent: 'run',
            title: resolvedTitle,
            objective: resolvedObjective,
            appRefs,
            scope: resolvedWorkScope,
            visibility: 'primary',
            primarySurfacePolicy: 'application_surface',
            primarySurface,
            assignment,
          })).work;

      if (workspace) {
        await rememberWorkspace(workspace.id);
      }
      await openWork(work);
      return work;
    }

    if (launch.kind !== 'agentSession') {
      throw new Error(`Product App ${productApp.name} cannot start a work session.`);
    }

    resolvedAgentChoice = (launch.agentType || launch.targetId || 'agentic') as NewWorkAgentChoice;
  }

  const descriptor = resolveDescriptorFromChoice(resolvedAgentChoice);
  const backendAgentType = getBackendAgentType(descriptor);
  const defaultTitle = labelForChoice(resolvedAgentChoice);
  const workTitle = resolvedTitle || defaultTitle;
  const workObjective = resolvedObjective || defaultTitle;

  syncSessionModeStore(descriptor);

  const work = await useWorkStore.getState().createWork({
    kind: resolvedAppRef ? 'app_workflow' : 'multi_step',
    title: workTitle,
    objective: workObjective,
    subject: resolvedAppRef
      ? { kind: 'app', app: resolvedAppRef, intent: 'run' }
      : { kind: 'goal' },
    appRefs: resolvedAppRef ? [{ app: resolvedAppRef, role: 'executor' }] : [],
    scope: resolvedWorkScope,
    visibility: 'primary',
    primarySurfacePolicy: 'work_session',
    titleState: title?.trim()
      ? { source: 'user', locked: true }
      : { source: 'template', locked: false },
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
  initialScopeRequirement,
}) => {
  const { t } = useI18n('common');
  const {
    openedWorkspacesList,
    recentWorkspaces,
    lastUsedWorkspace,
    rememberWorkspace,
    openWorkspace,
  } = useWorkspaceContext();

  const [agentChoice, setAgentChoice] = useState<NewWorkAgentChoice>('agentic');
  const [startMode, setStartMode] = useState<NewWorkStartMode>('manual');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [browsedWorkspacePath, setBrowsedWorkspacePath] = useState<string | null>(null);
  const [objective, setObjective] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [productApps, setProductApps] = useState<ProductAppCatalogEntry[]>([]);

  const knownBuiltinChoices = useMemo<Set<string>>(
    () => new Set(['agentic', 'Cowork', 'Design', 'DeepResearch']),
    []
  );

  const selectedProductAppId = parseProductAppWorkChoice(agentChoice);
  const selectedProductApp = useMemo(
    () => selectedProductAppId
      ? productApps.find((app) => app.id === selectedProductAppId) ?? null
      : null,
    [productApps, selectedProductAppId]
  );
  const initialChoiceScopeRequirement = initialAgentChoice === agentChoice
    ? initialScopeRequirement
    : undefined;
  const effectiveScopeRequirement = selectedProductApp
    ? getProductAppLaunchScopeRequirement(selectedProductApp)
    : initialChoiceScopeRequirement ?? getProductAppLaunchScopeRequirement(null);
  const workspaceRequired = startMode === 'manual' && effectiveScopeRequirement === 'workspaceRequired';

  const resetDefaults = useCallback((loadedProductApps?: ProductAppCatalogEntry[]) => {
    const apps = loadedProductApps ?? productApps;
    const normalizedInitialChoice = normalizeChoiceForAvailableApps(
      initialAgentChoice,
      apps,
      knownBuiltinChoices,
    );
    let storedAgent: NewWorkAgentChoice | null = null;
    let storedWorkspaceId: string | null = null;
    try {
      const rawAgent = localStorage.getItem(LS_AGENT) as NewWorkAgentChoice | null;
      storedAgent = normalizeChoiceForAvailableApps(rawAgent, apps, knownBuiltinChoices);
      storedWorkspaceId = localStorage.getItem(LS_WORKSPACE);
    } catch {
      /* ignore */
    }

    setAgentChoice(normalizedInitialChoice ?? storedAgent ?? defaultProductAppChoice(apps) ?? 'agentic');
    setStartMode('manual');
    setBrowsedWorkspacePath(null);
    setObjective('');
    setWorkspaceId(
      pickDefaultWorkspaceId(openedWorkspacesList, recentWorkspaces, lastUsedWorkspace, storedWorkspaceId)
    );
  }, [
    initialAgentChoice,
    knownBuiltinChoices,
    lastUsedWorkspace,
    openedWorkspacesList,
    productApps,
    recentWorkspaces,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    appCatalogAPI.listAppCatalog().then((apps) => {
      if (cancelled) return;
      const launchableApps = apps.filter((app) => (
        app.enabled && (
          app.launch?.kind === 'agentSession' ||
          app.launch?.kind === 'applicationSurface'
        )
      ));
      setProductApps(launchableApps);
      resetDefaults(launchableApps);
    }).catch((error) => {
      if (cancelled) return;
      log.error('Failed to load work executors', { error });
      setProductApps([]);
      resetDefaults([]);
    });
    return () => {
      cancelled = true;
    };
    // resetDefaults intentionally omitted to avoid resetting while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !initialAgentChoice) return;
    setAgentChoice(
      normalizeChoiceForAvailableApps(initialAgentChoice, productApps, knownBuiltinChoices) ??
      initialAgentChoice,
    );
    setStartMode('manual');
  }, [initialAgentChoice, isOpen, knownBuiltinChoices, productApps]);

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
    const options: SelectOption[] = workspaceRequired
      ? workspaceItems
      : [
          {
            label: t('nav.workDock.globalScopeLabel'),
            value: SYSTEM_WORKSPACE_VALUE,
            description: t('nav.workDock.globalScopeDescription'),
          },
          ...workspaceItems,
        ];
    if (browsedWorkspacePath) {
      options.splice(workspaceRequired ? 0 : 1, 0, {
        label: getBrowsedWorkspaceName(browsedWorkspacePath),
        value: BROWSED_WORKSPACE_VALUE,
        description: browsedWorkspacePath,
      });
    }
    return options;
  }, [browsedWorkspacePath, openedWorkspacesList, recentWorkspaces, t, workspaceRequired]);

  useEffect(() => {
    if (!isOpen || !workspaceRequired) return;
    if (workspaceId && workspaceId !== SYSTEM_WORKSPACE_VALUE) return;

    const defaultWorkspaceId = pickDefaultWorkspaceId(
      openedWorkspacesList,
      recentWorkspaces,
      lastUsedWorkspace,
      null
    );
    setWorkspaceId(defaultWorkspaceId === SYSTEM_WORKSPACE_VALUE ? null : defaultWorkspaceId);
  }, [
    isOpen,
    lastUsedWorkspace,
    openedWorkspacesList,
    recentWorkspaces,
    workspaceId,
    workspaceRequired,
  ]);

  const agentOptions = useMemo<SelectOption[]>(
    () => {
      if (productApps.length > 0) {
        return productApps.map((app) => ({
          value: productAppWorkChoice(app.id),
          label: app.name,
          description: app.goal || app.description,
          group: t('nav.workDock.executor.productAppGroup'),
        }));
      }

      return [
        {
          value: 'agentic',
          label: t('nav.workDock.executor.primeBuilder'),
          description: t('nav.workDock.executor.primeBuilderDescription'),
          group: t('nav.workDock.executor.systemGroup'),
        },
        {
          value: 'Cowork',
          label: t('nav.workDock.executor.cowork'),
          description: t('nav.workDock.executor.coworkDescription'),
          group: t('nav.workDock.executor.systemGroup'),
        },
        {
          value: 'Design',
          label: t('nav.workDock.executor.design'),
          description: t('nav.workDock.executor.designDescription'),
          group: t('nav.workDock.executor.systemGroup'),
        },
        {
          value: 'DeepResearch',
          label: t('nav.workDock.executor.research'),
          description: t('nav.workDock.executor.researchDescription'),
          group: t('nav.workDock.executor.systemGroup'),
        },
      ];
    },
    [productApps, t]
  );

  const startModeOptions = useMemo<Array<{
    value: NewWorkStartMode;
    title: string;
  }>>(() => [
    {
      value: 'manual',
      title: t('nav.workDock.modeManual'),
    },
    {
      value: 'agentic-os',
      title: t('nav.workDock.modeAgenticOs'),
    },
  ], [t]);
  const modeLede = startMode === 'manual'
    ? t('nav.workDock.modeManualLede')
    : t('nav.workDock.modeAgenticOsLede');

  const handleStartModeKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLButtonElement>,
    mode: NewWorkStartMode
  ) => {
    let nextMode: NewWorkStartMode | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextMode = mode === 'manual' ? 'agentic-os' : 'manual';
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextMode = mode === 'agentic-os' ? 'manual' : 'agentic-os';
    } else if (event.key === 'Home') {
      nextMode = 'manual';
    } else if (event.key === 'End') {
      nextMode = 'agentic-os';
    }

    if (!nextMode) return;
    event.preventDefault();
    setStartMode(nextMode);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-new-work-mode="${nextMode}"]`)
        ?.focus();
    });
  }, []);

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
          {knownBuiltinChoices.has(String(option.value)) && (
            <span className="new-work-dialog__system-badge">{t('nav.workDock.executor.systemBadge')}</span>
          )}
        </span>
      </div>
    );
  }, [knownBuiltinChoices, t]);

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
    const workspaceSelectionReady = workspaceId === BROWSED_WORKSPACE_VALUE
      ? Boolean(browsedWorkspacePath)
      : Boolean(workspaceId && workspaceId !== SYSTEM_WORKSPACE_VALUE);
    if (startMode === 'manual' && workspaceRequired && !workspaceSelectionReady) {
      notificationService.error(t('nav.workDock.workspaceRequired'), { duration: 3000 });
      return;
    }

    setSubmitting(true);
    try {
      if (startMode === 'agentic-os') {
        const agenticOsSessionId = await openAgenticOsSession();
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
      if (workspaceRequired && !workspace) {
        notificationService.error(t('nav.workDock.workspaceRequired'), { duration: 3000 });
        return;
      }
      await launchWorkForChoice({
        agentChoice,
        workspace,
        rememberWorkspace,
      });

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
    startMode,
    t,
    workspaceId,
    workspaceRequired,
  ]);

  const selectedWorkspaceOption = workspaceOptions.find((option) => option.value === (workspaceId ?? SYSTEM_WORKSPACE_VALUE));
  const workspaceSelectionReady = workspaceId === BROWSED_WORKSPACE_VALUE
    ? Boolean(browsedWorkspacePath)
    : Boolean(workspaceId && workspaceId !== SYSTEM_WORKSPACE_VALUE);
  const canSubmit = (startMode === 'manual' || objective.trim().length > 0)
    && (!workspaceRequired || workspaceSelectionReady)
    && !submitting;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      size="medium"
      contentInset
      contentClassName="new-work-dialog__modal-surface"
      overlayClassName="new-work-dialog-overlay"
      showCloseButton
      closeOnOverlayClick={false}
    >
      <div className="new-work-dialog" data-testid="new-work-dialog">
        <header className="new-work-dialog__masthead">
          <div className="new-work-dialog__intent-line">
            <span className="new-work-dialog__intent-prefix">{t('nav.workDock.intentPrefix')}</span>
            <div
              className="new-work-dialog__path-choice"
              role="radiogroup"
              aria-label={t('nav.workDock.modeAriaLabel')}
            >
              {startModeOptions.map((option, index) => {
                const selected = startMode === option.value;
                return (
                  <React.Fragment key={option.value}>
                    {index > 0 && (
                      <span className="new-work-dialog__path-separator" aria-hidden>
                        /
                      </span>
                    )}
                    <button
                      type="button"
                      className={`new-work-dialog__path-option${selected ? ' is-selected' : ''}`}
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      data-new-work-mode={option.value}
                      onClick={() => setStartMode(option.value)}
                      onKeyDown={(event) => handleStartModeKeyDown(event, option.value)}
                    >
                      <span className="new-work-dialog__path-title">{option.title}</span>
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
          <p key={startMode} className="new-work-dialog__lede">{modeLede}</p>
        </header>

        <div className="new-work-dialog__card">
          {startMode === 'agentic-os' ? (
            <section className="new-work-dialog__section" aria-labelledby="new-work-objective-heading">
              <div className="new-work-dialog__section-head">
                <span className="new-work-dialog__index" aria-hidden>
                  01
                </span>
                <h2 className="new-work-dialog__section-title" id="new-work-objective-heading">
                  {t('nav.workDock.newWorkSectionObjective')}
                </h2>
              </div>
              <Textarea
                className="new-work-dialog__objective"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                placeholder={t('nav.workDock.objectivePlaceholder')}
                rows={4}
                maxLength={600}
                showCount
                autoResize
                required
              />
            </section>
          ) : (
            <>
              <section className="new-work-dialog__section" aria-labelledby="new-work-agent-heading">
                <div className="new-work-dialog__section-head">
                  <span className="new-work-dialog__index" aria-hidden>
                    01
                  </span>
                  <h2 className="new-work-dialog__section-title" id="new-work-agent-heading">
                    {t('nav.workDock.newWorkSectionAgent')}
                  </h2>
                </div>
                <div className="new-work-dialog__control">
                  <Select
                    id="new-work-agent-select"
                    size="medium"
                    options={agentOptions}
                    value={agentChoice}
                    onChange={(value) => setAgentChoice(value as NewWorkAgentChoice)}
                    renderOption={renderAgentOption}
                    renderValue={renderAgentValue}
                    searchPlaceholder={t('nav.workDock.agentSearchPlaceholder')}
                    searchable
                  />
                </div>
              </section>

              <div className="new-work-dialog__divider" role="presentation" />

              <section className="new-work-dialog__section" aria-labelledby="new-work-workspace-heading">
                <div className="new-work-dialog__section-head">
                  <span className="new-work-dialog__index" aria-hidden>
                    02
                  </span>
                  <h2 className="new-work-dialog__section-title" id="new-work-workspace-heading">
                    {t('nav.workDock.newWorkSectionWorkspace')}
                  </h2>
                </div>
                <div className="new-work-dialog__workspace-row">
                  <div className="new-work-dialog__workspace-select">
                    <Select
                      size="medium"
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
                      emptyText={t('nav.workDock.noOpenWorkspace')}
                    />
                  </div>
                  <IconButton
                    type="button"
                    variant="default"
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
                <p className="new-work-dialog__scope-hint">
                  {workspaceRequired && !selectedWorkspaceOption
                    ? t('nav.workDock.workspaceRequiredHint')
                    : t('nav.workDock.scopePreview', {
                        scope: selectedWorkspaceOption?.label ?? t('nav.workDock.globalScopeLabel'),
                      })}
                </p>
              </section>
            </>
          )}
        </div>

        <footer className="new-work-dialog__actions">
          <Button type="button" variant="ghost" size="small" onClick={onClose} disabled={submitting}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="small"
            isLoading={submitting}
            onClick={() => void handleConfirm()}
            disabled={!canSubmit}
            data-testid="new-work-confirm"
          >
            {startMode === 'agentic-os'
              ? t('nav.workDock.confirmDispatch')
              : t('nav.workDock.confirmCreate')}
          </Button>
        </footer>
      </div>
    </Dialog>
  );
};
