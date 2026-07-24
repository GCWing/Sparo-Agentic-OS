/**
 * @vitest-environment jsdom
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import AppDetailScene from './AppDetailScene';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const labels: Record<string, string> = {
  'productSystem.detail.dialogLabel': 'App details',
  'productSystem.detail.journeys.overview.label': 'Overview',
  'productSystem.detail.journeys.overview.description': 'Understand its value',
  'productSystem.detail.journeys.work.label': 'Work',
  'productSystem.detail.journeys.work.description': 'Continue existing Work',
  'productSystem.detail.journeys.customize.label': 'Customize & evolve',
  'productSystem.detail.journeys.customize.description': 'Edit and fork',
  'productSystem.detail.journeys.control.label': 'Manage & trust',
  'productSystem.detail.journeys.control.description': 'Versions and permissions',
  'productSystem.detail.customize.systemTitle': 'Make it yours without changing the system app',
  'productSystem.detail.customize.systemDescription': 'Create a personal fork',
  'productSystem.detail.customize.versionTitle': 'Release and recovery',
  'productSystem.detail.customize.versionDescription': 'Publishing creates a Release',
  'productSystem.detail.customize.activeRelease': 'Active Release',
  'productSystem.detail.customize.availableRelease': 'Available Release',
  'productSystem.detail.customize.owner': 'Ownership',
  'productSystem.detail.control.componentsTitle': 'Components and capabilities',
  'productSystem.detail.control.technicalTitle': 'Technical and package details',
  'productSystem.detail.control.technicalHint': 'Advanced',
  'productSystem.detail.header.installed': 'Installed',
  'productSystem.detail.enabled': 'Enabled',
  'productSystem.detail.header.workMode': 'Work mode',
  'productSystem.detail.summary.availability': 'Availability',
  'productSystem.detail.summary.status': 'Status',
  'productSystem.detail.summary.permissions': 'Permissions',
  'productSystem.detail.summary.permissionCount': '0 / 6 enabled',
  'productSystem.detail.permissions.appTitle': 'App permissions',
  'productSystem.detail.permissions.dataTitle': 'Data lifecycle',
  'productSystem.detail.overview.recentWork': 'Recent work',
  'productSystem.detail.overview.recentWorkDescription': 'Pick up where you left off',
  'productSystem.detail.start.noWorkTitle': 'No work yet',
  'productSystem.detail.start.noWorkDescription': 'Work will appear here',
  'productSystem.detail.start.bestAction': 'Best next action',
  'productSystem.detail.start.launchHint': 'Start from the current context',
  'productSystem.detail.start.workTitle': 'Related work',
  'productSystem.actions.launch': 'Launch',
  'productSystem.actions.newWork': 'New',
  'productSystem.actions.customize': 'Customize a copy',
  'productSystem.actions.close': 'Close',
  'productSystem.owner.system': 'System app',
  'productSystem.interaction.conversation': 'Conversation',
  'productSystem.launchScope.systemAllowed': 'System allowed',
  'productSystem.workMultiplicity.multiple': 'Multiple works',
  'productSystem.fields.kind': 'Kind',
  'productSystem.fields.scope': 'Scope',
  'productSystem.fields.version': 'Version',
  'productSystem.permission.fs': 'Filesystem',
  'productSystem.permission.net': 'Network',
  'productSystem.permission.shell': 'Shell',
  'productSystem.permission.gui': 'GUI',
  'productSystem.permission.secrets': 'Secrets',
  'productSystem.permission.ai': 'Model access',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => labels[key] ?? key,
  }),
}));

const app = {
  id: 'runno',
  appId: 'runno',
  slotId: 'runno',
  releaseId: 'release-1',
  availableReleaseId: 'release-1',
  configRevision: 'config-1',
  dataSchemaVersion: '1',
  ownerKind: 'system',
  version: '1.0.0',
  name: 'Runno',
  description: 'General execution app',
  interactionModel: 'conversation',
  workMultiplicity: 'multiple',
  primarySurfaceMode: 'chatPrimary',
  components: [],
  componentLockId: 'lock-1',
  componentLockDigest: 'lock-1',
  permissions: {},
  installScope: 'system',
  catalogVisibility: 'discoverable',
  enabled: true,
  icon: { kind: 'nativeAsset', assetId: 'runno' },
  category: 'system',
  tags: ['execution'],
  launch: {
    kind: 'agentSession',
    targetId: 'Runno',
    scopeRequirement: 'systemAllowed',
    agentType: 'Runno',
  },
  installed: true,
  discoverable: false,
  updateAvailable: false,
} as ProductAppCatalogEntry;

function clickButton(name: string): void {
  const button = [...document.querySelectorAll('button')]
    .find((candidate) => (
      candidate.textContent?.includes(name)
      || candidate.getAttribute('aria-label') === name
    ));
  expect(button).toBeTruthy();
  button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('AppDetailScene user journeys', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onLaunch = vi.fn();
  const onCustomize = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onLaunch.mockReset();
    onCustomize.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  it('keeps the primary use action explicit and routes customization separately', () => {
    act(() => {
      root.render(
        <AppDetailScene
          appKind="product"
          app={app}
          components={[]}
          works={[]}
          onBack={vi.fn()}
          onLaunch={onLaunch}
          onStop={vi.fn()}
          running={false}
          stopping={false}
          onOpenWork={vi.fn()}
          onOpenComponent={vi.fn()}
          managing={false}
          onInstall={vi.fn()}
          onCustomize={onCustomize}
          onSyncUpstream={vi.fn()}
        />,
      );
    });

    expect(document.body.textContent).toContain('General execution app');
    expect(document.querySelector('.app-detail-scene__header-close')).toBeTruthy();
    expect(document.querySelector('.app-detail-scene__header-actions .app-detail-scene__header-close')).toBeNull();
    act(() => clickButton('New'));
    expect(onLaunch).toHaveBeenCalledTimes(1);

    act(() => clickButton('Customize & evolve'));
    expect(document.body.textContent).toContain('Make it yours without changing the system app');
    act(() => clickButton('Customize a copy'));
    expect(onCustomize).toHaveBeenCalledTimes(1);

    act(() => clickButton('Manage & trust'));
    expect(document.body.textContent).toContain('Components and capabilities');
    expect(document.body.textContent).toContain('Technical and package details');
  });
});
