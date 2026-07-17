/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowToolItem, ToolCardConfig } from '../types/flow-chat';
import { SettingsChangePreviewCard } from './SettingsChangePreviewCard';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const openManualLocation = vi.hoisted(() => vi.fn());
const undoConfigCommit = vi.hoisted(() => vi.fn());
const refreshSnapshot = vi.hoisted(() => vi.fn(async () => ({ revision: 6 })));
const catalogState = {
  status: 'ready' as const,
  catalog: { version: 'catalog-v1' },
  error: null,
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options?.count !== undefined) return `${key}:${options.count}`;
      return key;
    },
    i18n: {
      t: (key: string, options?: { defaultValue?: string }) => (
        key === 'settings/config-center:fields.interfaceScale'
          ? 'Interface scale'
          : options?.defaultValue ?? key
      ),
    },
  }),
}));

vi.mock('@/design-system', () => ({
  Button: ({ children, disabled, onClick, className }: any) => (
    <button className={className} disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  ),
  IconButton: ({ children, disabled, onClick, className, 'aria-label': ariaLabel }: any) => (
    <button className={className} disabled={disabled} onClick={onClick} type="button" aria-label={ariaLabel}>
      {children}
    </button>
  ),
  ToolCard: ({ children, className, status, tone, ...props }: any) => (
    <article className={className} data-status={status} data-tone={tone} {...props}>
      {children}
    </article>
  ),
  ToolCardHeader: ({ icon, title, meta, actions }: any) => (
    <header>{icon}{title}{meta}{actions}</header>
  ),
  ToolCardBody: ({ children }: any) => <div>{children}</div>,
  ToolCardFooter: ({ children, className }: any) => <footer className={className}>{children}</footer>,
  FormField: ({ children, label, description, className }: any) => (
    <div className={className}>
      <span>{label}</span>
      {description ? <span>{description}</span> : null}
      {children}
    </div>
  ),
}));

vi.mock('@/app/scenes/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ openManualLocation }),
  },
}));

vi.mock('@/infrastructure/config', () => ({
  configCatalogStore: {
    subscribe: () => () => undefined,
    getState: () => catalogState,
    load: vi.fn(),
    getDescriptor: (settingId: string) => settingId === 'core.ui.interface_scale'
      ? {
          id: settingId,
        presentation: {
          titleKey: 'settings/config-center:fields.interfaceScale',
          descriptionKey: 'settings/config-center:descriptions.interfaceScale',
          categoryId: 'appearance',
          tabId: 'appearance',
          sectionId: 'interface',
          fieldId: 'interface-scale',
          control: 'select',
          order: 10,
          hidden: false,
        },
          resolvedOptions: [],
        }
      : undefined,
  },
  configSnapshotStore: {
    refresh: refreshSnapshot,
    getState: () => ({ snapshot: { revision: 7 } }),
  },
}));

vi.mock('@/infrastructure/api', () => ({
  configAPI: { undoConfigCommit },
}));

const config: ToolCardConfig = {
  toolName: 'SettingsChange',
  displayName: 'Settings change',
  icon: '',
  requiresConfirmation: false,
  resultDisplayType: 'detailed',
};

const section = {
  categoryId: 'appearance',
  tabId: 'appearance',
  sectionId: 'interface',
  fieldIds: ['interface-scale'],
};

function plan(changes: unknown[], warnings: unknown[] = []) {
  return {
    planId: 'plan-secret-id',
    baseRevision: 4,
    catalogVersion: 'catalog-v1',
    operationHash: 'private-operation-hash',
    expiresAtMs: Date.now() + 60_000,
    changes,
    requiresConfirmation: true,
    affectedSections: [section],
    warnings,
  };
}

function tool(overrides: Partial<FlowToolItem>): FlowToolItem {
  return {
    id: 'settings-tool-1',
    type: 'tool',
    toolName: 'SettingsChange',
    toolCall: {
      id: 'settings-tool-1',
      input: { action: 'plan', expectedRevision: 4, operations: [] },
    },
    timestamp: 1,
    status: 'running',
    runtime: {
      lifecycle: 'running',
      inputPhase: 'parsed',
      confirmation: 'none',
      input: { action: 'plan' },
    },
    ...overrides,
  };
}

function renderCard(toolItem: FlowToolItem): string {
  return renderToStaticMarkup(
    <SettingsChangePreviewCard config={config} toolItem={toolItem} />,
  );
}

afterEach(() => {
  openManualLocation.mockReset();
  undoConfigCommit.mockReset();
  refreshSnapshot.mockClear();
});

describe('SettingsChangePreviewCard', () => {
  it('renders completed plan details and omits transaction internals', () => {
    const html = renderCard(tool({
      status: 'completed',
      runtime: {
        lifecycle: 'completed',
        inputPhase: 'parsed',
        confirmation: 'none',
        input: { action: 'plan' },
      },
      toolResult: {
        success: true,
        result: plan([{
          settingId: 'core.ui.interface_scale',
          before: { kind: 'value', value: 1 },
          after: { kind: 'value', value: 1.2 },
          risk: 'safe',
          applyStrategy: 'reactive',
        }]),
      },
    }));

    expect(html).toContain('settings-change-preview-card__changes');
    expect(html).toContain('settings-change-preview-card__section');
    expect(html).toContain('data-setting-section="interface"');
    expect(html).toContain('Interface scale');
    expect(html).toContain('toolCards.settingsChange.comparison.before');
    expect(html).toContain('toolCards.settingsChange.comparison.after');
    expect(html).toContain('settings-change-preview-card__value-phase is-before');
    expect(html).toContain('settings-change-preview-card__value-phase is-after');
    expect(html).not.toContain('lucide-arrow-right');
    expect(html).toContain('toolCards.settingsChange.effects.reactive');
    expect(html).toContain('1.2');
    expect(html).toContain('toolCards.settingsChange.status.plan.completed:1');
    expect(html).not.toContain('data-variant=');
    expect(html).not.toContain('plan-secret-id');
    expect(html).not.toContain('private-operation-hash');
  });

  it('renders the authoritative apply preview without exposing secret metadata', () => {
    const authoritativePlan = plan([{
      settingId: 'core.ui.interface_scale',
      before: {
        kind: 'secret',
        configured: true,
        provider: 'provider-that-must-not-render',
        maskedSuffix: 'private-suffix',
      },
      after: {
        kind: 'secret',
        configured: true,
        provider: 'another-private-provider',
      },
      risk: 'elevated',
      applyStrategy: 'restartRequired',
      path: 'C:/private/config.json',
    }]);
    const html = renderCard(tool({
      status: 'pending_confirmation',
      requiresConfirmation: true,
      runtime: {
        lifecycle: 'waiting_confirmation',
        inputPhase: 'parsed',
        confirmation: 'required',
        input: { action: 'apply', plan: authoritativePlan },
      },
      toolCall: {
        id: 'settings-tool-1',
        input: { action: 'apply', plan: authoritativePlan },
      },
    }));

    expect(html).toContain('Interface scale');
    expect(html).toContain('toolCards.settingsChange.secret.configured');
    expect(html).toContain('toolCards.settingsChange.secret.willUpdate');
    expect(html).not.toContain('provider-that-must-not-render');
    expect(html).not.toContain('private-suffix');
    expect(html).not.toContain('C:/private/config.json');
  });

  it('uses the standard confirm and reject callbacks and opens the affected manual section', async () => {
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    const authoritativePlan = plan([{
      settingId: 'core.ui.interface_scale',
      before: { kind: 'value', value: 1 },
      after: { kind: 'value', value: 1.2 },
      risk: 'elevated',
      applyStrategy: 'reactive',
    }]);
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <SettingsChangePreviewCard
          config={config}
          toolItem={tool({
            status: 'pending_confirmation',
            requiresConfirmation: true,
            runtime: {
              lifecycle: 'waiting_confirmation',
              inputPhase: 'parsed',
              confirmation: 'required',
              input: { action: 'apply', plan: authoritativePlan },
            },
            toolCall: {
              id: 'settings-tool-1',
              input: { action: 'apply', plan: authoritativePlan },
            },
          })}
          onConfirm={onConfirm}
          onReject={onReject}
        />,
      );
    });

    const buttons = Array.from(host.querySelectorAll('button'));
    const byText = (text: string) => buttons.find((button) => button.textContent === text);
    const manualButton = buttons.find((button) => (
      button.getAttribute('aria-label') === 'toolCards.settingsChange.actions.viewManual'
    ));

    await act(async () => {
      manualButton?.click();
      byText('toolCards.settingsChange.actions.cancel')?.click();
      byText('toolCards.settingsChange.actions.confirm.apply')?.click();
    });

    expect(openManualLocation).toHaveBeenCalledWith({
      tabId: 'appearance',
      sectionId: 'interface',
      fieldId: 'interface-scale',
    });
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it('keeps the preview readable while disabling mutations under a read-only host policy', async () => {
    const onConfirm = vi.fn();
    const onReject = vi.fn();
    const authoritativePlan = plan([{
      settingId: 'core.ui.interface_scale',
      before: { kind: 'value', value: 1 },
      after: { kind: 'value', value: 1.2 },
      risk: 'elevated',
      applyStrategy: 'reactive',
    }]);
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <SettingsChangePreviewCard
          config={config}
          mutationsDisabled
          toolItem={tool({
            status: 'pending_confirmation',
            requiresConfirmation: true,
            runtime: {
              lifecycle: 'waiting_confirmation',
              inputPhase: 'parsed',
              confirmation: 'required',
              input: { action: 'apply', plan: authoritativePlan },
            },
            toolCall: {
              id: 'settings-tool-1',
              input: { action: 'apply', plan: authoritativePlan },
            },
          })}
          onConfirm={onConfirm}
          onReject={onReject}
        />,
      );
    });

    const buttons = Array.from(host.querySelectorAll('button'));
    const byText = (text: string) => buttons.find((button) => button.textContent === text);
    const manual = buttons.find((button) => (
      button.getAttribute('aria-label') === 'toolCards.settingsChange.actions.viewManual'
    ));
    const reject = byText('toolCards.settingsChange.actions.cancel');
    const confirm = byText('toolCards.settingsChange.actions.confirm.apply');

    expect(host.textContent).toContain('Interface scale');
    expect(manual?.disabled).toBe(false);
    expect(reject?.disabled).toBe(true);
    expect(confirm?.disabled).toBe(true);

    await act(async () => {
      manual?.click();
      reject?.click();
      confirm?.click();
    });

    expect(openManualLocation).toHaveBeenCalledOnce();
    expect(onReject).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('reverses the original commit direction for an undo confirmation preview', () => {
    const html = renderCard(tool({
      status: 'pending_confirmation',
      requiresConfirmation: true,
      runtime: {
        lifecycle: 'waiting_confirmation',
        inputPhase: 'parsed',
        confirmation: 'required',
        input: {
          action: 'undo',
          confirmation: {
            commitId: 'commit-1',
            revision: 5,
            changes: [{
              settingId: 'core.theme.mode',
              oldValue: { kind: 'value', value: 'light' },
              newValue: { kind: 'value', value: 'dark' },
              applyStrategy: 'reactive',
            }],
            affectedSections: [section],
            requiresConfirmation: true,
          },
        },
      },
      toolCall: {
        id: 'settings-tool-1',
        input: {
          action: 'undo',
          confirmation: {
            commitId: 'commit-1',
            revision: 5,
            changes: [{
              settingId: 'core.theme.mode',
              oldValue: { kind: 'value', value: 'light' },
              newValue: { kind: 'value', value: 'dark' },
              applyStrategy: 'reactive',
            }],
            affectedSections: [section],
            requiresConfirmation: true,
          },
        },
      },
    }));

    expect(html.indexOf('dark')).toBeLessThan(html.indexOf('light'));
    expect(html).toContain('toolCards.settingsChange.status.undo.confirming:1');
  });

  it('renders partial and restart-required receipt states from the committed result', () => {
    const html = renderCard(tool({
      status: 'completed',
      runtime: {
        lifecycle: 'completed',
        inputPhase: 'parsed',
        confirmation: 'approved',
        input: { action: 'apply' },
      },
      toolCall: { id: 'settings-tool-1', input: { action: 'apply' } },
      toolResult: {
        success: true,
        result: {
          commitId: 'commit-1',
          revision: 5,
          status: 'partial',
          scope: { kind: 'user' },
          source: { kind: 'ai' },
          changes: [
            {
              settingId: 'core.ui.interface_scale',
              oldValue: { kind: 'value', value: 1 },
              newValue: { kind: 'value', value: 1.2 },
              applyStrategy: 'adapter',
            },
            {
              settingId: 'core.process.runtime',
              oldValue: { kind: 'value', value: 'stable' },
              newValue: { kind: 'value', value: 'preview' },
              applyStrategy: 'restartRequired',
            },
          ],
          applyReceipts: [
            {
              consumer: 'ui-owner',
              settingIds: ['core.ui.interface_scale'],
              attempt: 1,
              attemptedAt: '2026-07-15T00:00:00Z',
              status: 'failed',
              critical: false,
            },
            {
              consumer: 'process-owner',
              settingIds: ['core.process.runtime'],
              attempt: 1,
              attemptedAt: '2026-07-15T00:00:00Z',
              status: 'restartRequired',
              critical: false,
            },
          ],
          affectedSections: [section],
          restartRequired: ['core.process.runtime'],
          undoToken: 'private-undo-token',
          committedAt: '2026-07-15T00:00:00Z',
        },
      },
    }));

    expect(html).toContain('toolCards.settingsChange.status.result.partial:2');
    expect(html).toContain('toolCards.settingsChange.receipts.failed');
    expect(html).toContain('toolCards.settingsChange.effects.restartRequired');
    expect(html).toContain('toolCards.settingsChange.partialNotice');
    expect(html).not.toContain('private-undo-token');
    expect(html).not.toContain('ui-owner');
  });

  it('renders a compact applied receipt and executes its undo action without exposing the token', async () => {
    undoConfigCommit.mockResolvedValue({
      commitId: 'rollback-1',
      revision: 7,
      committedAt: '2026-07-15T00:01:00Z',
    });
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <SettingsChangePreviewCard
          config={config}
          toolItem={tool({
            status: 'completed',
            runtime: {
              lifecycle: 'completed',
              inputPhase: 'parsed',
              confirmation: 'approved',
              input: { action: 'apply' },
            },
            toolCall: { id: 'settings-tool-1', input: { action: 'apply' } },
            toolResult: {
              success: true,
              result: {
                commitId: 'commit-1',
                revision: 5,
                status: 'applied',
                scope: { kind: 'user' },
                source: { kind: 'ai' },
                changes: [{
                  settingId: 'core.ui.interface_scale',
                  oldValue: { kind: 'value', value: 1 },
                  newValue: { kind: 'value', value: 1.2 },
                  applyStrategy: 'adapter',
                }],
                applyReceipts: [],
                affectedSections: [section],
                restartRequired: [],
                undoToken: 'private-undo-token',
                committedAt: '2026-07-15T00:00:00Z',
              },
            },
          })}
        />,
      );
    });

    expect(host.innerHTML).toContain('settings-change-receipt');
    expect(host.innerHTML).toContain('compact-tool-card');
    expect(host.textContent).toContain('toolCards.settingsChange.status.apply.completed:1');
    expect(host.innerHTML).not.toContain('private-undo-token');

    await act(async () => {
      host.querySelector('button')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(undoConfigCommit).toHaveBeenCalledWith({
      commitId: 'commit-1',
      undoToken: 'private-undo-token',
      expectedRevision: 6,
      idempotencyKey: 'settings-card-undo-commit-1-6',
      confirmed: true,
    });
    expect(host.textContent).toContain('toolCards.settingsChange.status.result.undone:1');

    await act(async () => root.unmount());
  });

  it('maps tool failures to stable copy without rendering the raw error', () => {
    const html = renderCard(tool({
      status: 'error',
      runtime: {
        lifecycle: 'error',
        inputPhase: 'parsed',
        confirmation: 'none',
        input: { action: 'apply' },
        error: 'config.revision_conflict at C:/private/config.json token=secret-value',
      },
      toolCall: { id: 'settings-tool-1', input: { action: 'apply' } },
      toolResult: {
        success: false,
        result: null,
        error: 'config.revision_conflict at C:/private/config.json token=secret-value',
      },
    }));

    expect(html).toContain('toolCards.settingsChange.errors.config.revision_conflict');
    expect(html).not.toContain('C:/private/config.json');
    expect(html).not.toContain('secret-value');
  });

  it('disables confirmation when the authoritative preview is unavailable', () => {
    const html = renderToStaticMarkup(
      <SettingsChangePreviewCard
        config={config}
        toolItem={tool({
          status: 'pending_confirmation',
          requiresConfirmation: true,
          runtime: {
            lifecycle: 'waiting_confirmation',
            inputPhase: 'parsed',
            confirmation: 'required',
            input: { action: 'apply', unavailable: true },
          },
          toolCall: {
            id: 'settings-tool-1',
            input: { action: 'apply', unavailable: true },
          },
        })}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(html).toContain('toolCards.settingsChange.previewUnavailable');
    expect(html).toContain('disabled=""');
  });
});
