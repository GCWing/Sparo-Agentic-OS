import type { SessionProfile } from '../types';
import type { AgentSessionBindingMetadata } from '@/shared/types/session-history';

function getBoundAppStudioBinding(extra?: Record<string, unknown>): AgentSessionBindingMetadata | undefined {
  const binding = extra?.agentSessionBinding as AgentSessionBindingMetadata | undefined;
  return binding?.subject.kind === 'product-app' || binding?.subject.kind === 'component'
    ? binding
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === 'string' && field.trim() ? field : undefined;
}

function getBoundAppStudioAppId(extra?: Record<string, unknown>): string | undefined {
  const binding = getBoundAppStudioBinding(extra);
  if (binding?.subject.kind === 'product-app') return binding.subject.id;
  if (binding?.subject.kind === 'component') return undefined;

  const appId = extra?.appId;
  return typeof appId === 'string' && appId.trim() ? appId : undefined;
}

function getBoundAppStudioComponent(extra?: Record<string, unknown>): Record<string, string | undefined> | undefined {
  const binding = getBoundAppStudioBinding(extra);
  if (binding?.subject.kind !== 'component') return undefined;

  const subjectData = asRecord(binding.subject.data);
  const customMetadata = asRecord(extra?.customMetadata);
  const facts = asRecord(customMetadata?.appStudioFacts);
  const factsSubject = asRecord(facts?.subject);
  const blueprint = asRecord(facts?.blueprint);
  const subjectVersion = binding.subject.version;
  const componentVersion = typeof subjectVersion === 'string' && subjectVersion.trim()
    ? subjectVersion
    : typeof subjectVersion === 'number'
      ? String(subjectVersion)
      : stringField(subjectData, 'version') ?? stringField(factsSubject, 'version');

  return {
    componentId: binding.subject.id,
    componentKind: stringField(subjectData, 'componentKind') ?? stringField(factsSubject, 'componentKind'),
    componentVersion,
    componentPackageRoot: stringField(subjectData, 'packageRoot') ?? stringField(factsSubject, 'packageRoot'),
    componentName: binding.subject.title,
    componentDescription: stringField(subjectData, 'description') ?? stringField(blueprint, 'whatItDoes'),
  };
}

function getPanelTitle(extra?: Record<string, unknown>): string {
  const binding = getBoundAppStudioBinding(extra);
  return (
    binding?.surface?.title ||
    (extra?.tabTitle as string | undefined) ||
    binding?.subject.title ||
    'App Studio'
  );
}

export const appStudioProfile: SessionProfile = {
  id: 'app-studio',

  layout: {
    showChat: true,
    defaultAuxPane: 'visible',
    chatCollapsible: true,
  },

  auxTabs: {
    /**
     * Auto-open the App Studio panel tab when this session becomes active.
     * `extra.appId` is the optional Product App ID from the app surface runtime store.
     */
    autoOpen(sessionId, extra) {
      const appId = getBoundAppStudioAppId(extra);
      const component = getBoundAppStudioComponent(extra);
      const duplicateCheckKey = `app-studio:${sessionId}`;
      return {
        type: 'app-studio',
        title: getPanelTitle(extra),
        data: {
          sessionId,
          appId,
          componentId: component?.componentId,
          componentKind: component?.componentKind,
          componentVersion: component?.componentVersion,
          componentPackageRoot: component?.componentPackageRoot,
          componentName: component?.componentName,
          componentDescription: component?.componentDescription,
          scope: getBoundAppStudioBinding(extra)?.scope,
        },
        metadata: {
          appStudioSessionId: sessionId,
          appStudioAppId: appId,
          appStudioComponentId: component?.componentId,
          appStudioComponentKind: component?.componentKind,
          componentVersion: component?.componentVersion,
          componentPackageRoot: component?.componentPackageRoot,
          componentName: component?.componentName,
          componentDescription: component?.componentDescription,
          agentSessionBinding: extra?.agentSessionBinding,
          appScope: getBoundAppStudioBinding(extra)?.scope,
        },
        duplicateCheckKey,
        replaceExisting: true,
      };
    },

    exclusiveTabTypes: ['app-studio'],
  },

  sidecarActions(sessionId, extra) {
    const duplicateCheckKey = `app-studio:${sessionId}`;
    const appId = getBoundAppStudioAppId(extra);
    const component = getBoundAppStudioComponent(extra);
    return [
      {
        id: 'app-studio',
        labelKey: 'flowChatHeader.sidecar.appStudio',
        defaultLabel: 'App Studio',
        icon: 'app-window',
        order: 10,
        panel: {
          type: 'app-studio',
          title: getPanelTitle(extra),
          data: {
            sessionId,
            appId,
            componentId: component?.componentId,
            componentKind: component?.componentKind,
            componentVersion: component?.componentVersion,
            componentPackageRoot: component?.componentPackageRoot,
            componentName: component?.componentName,
            componentDescription: component?.componentDescription,
            scope: getBoundAppStudioBinding(extra)?.scope,
          },
          metadata: {
            appStudioSessionId: sessionId,
            appStudioAppId: appId,
            appStudioComponentId: component?.componentId,
            appStudioComponentKind: component?.componentKind,
            componentVersion: component?.componentVersion,
            componentPackageRoot: component?.componentPackageRoot,
            componentName: component?.componentName,
            componentDescription: component?.componentDescription,
            agentSessionBinding: extra?.agentSessionBinding,
            appScope: getBoundAppStudioBinding(extra)?.scope,
            duplicateCheckKey,
          },
          duplicateCheckKey,
          replaceExisting: true,
        },
      },
    ];
  },

  buildAgentContextHint(_session, binding) {
    if (binding.intent.agentType !== 'AppStudio') return null;
    if (binding.intent.mode !== 'edit') return null;

    if (binding.subject.kind === 'component') {
      const data = asRecord(binding.subject.data);
      const componentId = binding.subject.id;
      const componentName = binding.subject.title || componentId;
      const componentKind = stringField(data, 'componentKind') || 'component';
      const packageRoot = stringField(data, 'packageRoot');
      return {
        metadata: {
          agentSessionBinding: binding,
          appStudioComponentId: componentId,
          appStudioComponentKind: componentKind,
          componentVersion: binding.subject.version,
          componentPackageRoot: packageRoot,
          appScope: binding.scope,
        },
        systemReminder: [
          `You are editing existing Component package "${componentName}" (component_id=${componentId}, kind=${componentKind}).`,
          packageRoot ? `Bound package root: ${packageRoot}.` : '',
          binding.scope.kind === 'workspace'
            ? `Component scope: workspace (${binding.scope.workspacePath}).`
            : 'Component scope: system component storage.',
          'Do not call CreateComponentPackage unless the user explicitly asks for a new component.',
          'Read and edit only this Component package: component.json, source files, contract tests, and related metadata.',
          'After package edits, validate the component contract and run the narrowest relevant checks for the touched runtime or UI code.',
        ].filter(Boolean).join('\n'),
      };
    }

    if (binding.subject.kind !== 'product-app') return null;

    const appId = binding.subject.id;
    const appName = binding.subject.title || appId;
    const scopeReminder =
      binding.scope.kind === 'workspace'
        ? `App scope: workspace (${binding.scope.workspacePath}).`
        : 'App scope: system App storage.';
    return {
      metadata: {
        agentSessionBinding: binding,
        appStudioAppId: appId,
        appScope: binding.scope,
      },
      systemReminder: [
        `You are editing existing Product App "${appName}" (app_id=${appId}).`,
        scopeReminder,
        'Do not call CreateProductApp unless the user explicitly asks for a new app.',
        'Read and edit only this Product App package: app.json, app.lock.json, app-private components, source files, and tests.',
        'When the Product App needs a missing app-private implementation unit, use CreateProductAppComponent instead of shared Component Package tools.',
        'After package edits, validate the package contract and run the narrowest relevant checks for the touched runtime or UI code.',
      ].join('\n'),
    };
  },

  capabilities: {
    showWelcomePanel: false,
    showAgenticOsModelRoundUI: false,
  },

  workspaceScope: {
    kind: 'global',
  },

  theme: {
    dataAgent: 'app-studio',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
