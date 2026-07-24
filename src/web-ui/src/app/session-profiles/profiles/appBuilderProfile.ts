import type { SessionProfile } from '../types';
import type { AgentSessionBindingMetadata } from '@/shared/types/session-history';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const field = value?.[key];
  return typeof field === 'string' && field.trim() ? field : undefined;
}

function getBoundDraftBinding(
  extra?: Record<string, unknown>,
): AgentSessionBindingMetadata | undefined {
  const binding = extra?.agentSessionBinding as AgentSessionBindingMetadata | undefined;
  return binding?.subject.kind === 'builder-draft' ? binding : undefined;
}

function getBoundDraft(extra?: Record<string, unknown>) {
  const binding = getBoundDraftBinding(extra);
  if (!binding) return undefined;
  const data = asRecord(binding.surface?.data);
  return {
    draftId: binding.subject.id,
    appId: stringField(data, 'appId'),
    slotId: stringField(data, 'slotId'),
    baseReleaseId: stringField(data, 'baseReleaseId'),
  };
}

function getPanelTitle(extra?: Record<string, unknown>): string {
  const binding = getBoundDraftBinding(extra);
  return (
    binding?.surface?.title ||
    (extra?.tabTitle as string | undefined) ||
    binding?.subject.title ||
    'App Builder'
  );
}

function buildPanel(sessionId: string, extra?: Record<string, unknown>) {
  const binding = getBoundDraftBinding(extra);
  const draft = getBoundDraft(extra);
  return {
    type: 'app-builder',
    title: getPanelTitle(extra),
    data: {
      sessionId,
      appId: draft?.appId,
      draftId: draft?.draftId,
      slotId: draft?.slotId,
      baseReleaseId: draft?.baseReleaseId,
      scope: binding?.scope,
    },
    metadata: {
      appBuilderSessionId: sessionId,
      appBuilderAppId: draft?.appId,
      appBuilderDraftId: draft?.draftId,
      agentSessionBinding: binding,
      appScope: binding?.scope,
      duplicateCheckKey: `app-builder:${sessionId}`,
    },
    duplicateCheckKey: `app-builder:${sessionId}`,
    replaceExisting: true,
  } as const;
}

export const appBuilderProfile: SessionProfile = {
  id: 'app-builder',

  auxiliarySurface: {
    defaultVisibility: 'visible',
    initialize(sessionId, extra) {
      return buildPanel(sessionId, extra);
    },
  },

  sidecarActions(sessionId, extra) {
    return [
      {
        id: 'app-builder',
        labelKey: 'flowChatHeader.sidecar.appBuilder',
        defaultLabel: 'App Builder',
        icon: 'app-window',
        order: 10,
        panel: buildPanel(sessionId, extra),
      },
    ];
  },

  buildAgentContextHint(_session, binding) {
    if (binding.intent.agentType !== 'AppBuilder') return null;
    if (binding.subject.kind !== 'builder-draft') return null;

    const data = asRecord(binding.surface?.data);
    const draftId = binding.subject.id;
    const appId = stringField(data, 'appId');
    const slotId = stringField(data, 'slotId');
    const baseReleaseId = stringField(data, 'baseReleaseId');
    const appName = binding.subject.title || appId || draftId;
    const scopeReminder =
      binding.scope.kind === 'workspace'
        ? `App scope: workspace (${binding.scope.workspacePath}).`
        : 'App scope: system App storage.';
    return {
      metadata: {
        agentSessionBinding: binding,
        appBuilderAppId: appId,
        appBuilderDraftId: draftId,
        appScope: binding.scope,
      },
      systemReminder: [
        `You are editing mutable App Draft "${appName}" (draft_id=${draftId}${appId ? `, app_id=${appId}` : ''}${slotId ? `, slot_id=${slotId}` : ''}).`,
        baseReleaseId ? `The Draft was derived from immutable Release ${baseReleaseId}.` : 'This Draft has no base Release.',
        scopeReminder,
        'The Draft identity is the only filesystem authority. Never accept or infer a package root from session, turn, or tool-result metadata.',
        'Edit only this Draft. Never edit an active or immutable Release artifact.',
        'When the App needs a private implementation unit, create it inside the bound Draft instead of mutating shared Components.',
        'Preview through the isolated Draft preview runtime; preview must not create or mutate formal Work.',
        'After edits, validate the Draft. Publishing creates a new immutable Release and activation remains a separate explicit action.',
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
    dataAgent: 'app-builder',
  },

  topBar: {
    showContextNav: true,
    showWorkspaceName: true,
  },
};
