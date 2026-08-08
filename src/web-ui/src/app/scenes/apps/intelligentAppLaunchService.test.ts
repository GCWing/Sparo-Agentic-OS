import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveAppRef } from '@/infrastructure/api/service-api/IntelligentAppAPI';
import { launchActiveIntelligentApp } from './intelligentAppLaunchService';

const mocks = vi.hoisted(() => ({
  openProductAppRuntime: vi.fn(),
}));

vi.mock('./product-app-runtime/productAppRuntimeService', () => ({
  openProductAppRuntime: mocks.openProductAppRuntime,
}));

vi.mock('./app-builder/openAppBuilderSession', () => ({
  createAndOpenAppBuilder: vi.fn(),
}));

vi.mock('@/app/agentic-os/work/data/workStore', () => ({
  useWorkStore: { getState: vi.fn() },
}));

vi.mock('@/app/agentic-os/work/domain/productAppRefs', () => ({
  productAppWorkRef: vi.fn(),
}));

vi.mock('@/app/agentic-os/work/navigation/openWork', () => ({
  openWork: vi.fn(),
}));

vi.mock('@/app/stores/sessionModeStore', () => ({
  useSessionModeStore: { getState: vi.fn() },
}));

vi.mock('@/app/session-profiles', () => ({
  resolveSessionTypeDefinitionForDescriptor: vi.fn(),
}));

vi.mock('@/flow_chat/domain/sessionDescriptor', () => ({
  descriptorFromAgentType: vi.fn(),
  getBackendAgentType: vi.fn(),
}));

function applicationSurfaceApp(): ActiveAppRef {
  return {
    slotId: 'builtin-ppt-live',
    appId: 'builtin-ppt-live',
    releaseId: 'release-ppt-live',
    configRevision: 'config-ppt-live',
    dataSchemaVersion: '1',
    runtime: {
      launch: {
        kind: 'applicationSurface',
        targetId: 'builtin-ppt-live',
        scopeRequirement: 'workspaceOptional',
      },
      primarySurface: {
        componentId: 'builtin-ppt-live-surface',
        surfaceId: 'primary',
      },
      primarySurfaceMode: 'immersivePrimary',
      workMultiplicity: 'multiple',
      icon: { kind: 'builtin', name: 'presentation' },
      category: 'productivity',
      tags: [],
    },
  };
}

describe('launchActiveIntelligentApp intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.openProductAppRuntime.mockResolvedValue(undefined);
  });

  it('maps an explicit new-object intent to fresh Work creation', async () => {
    await launchActiveIntelligentApp(applicationSurfaceApp(), {
      title: 'New presentation',
      intent: { kind: 'create_new' },
    });

    expect(mocks.openProductAppRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'builtin-ppt-live' }),
      expect.objectContaining({
        title: 'New presentation',
        workMode: 'create',
      }),
    );
  });

  it('maps an explicit resume intent to the most recent compatible Work', async () => {
    await launchActiveIntelligentApp(applicationSurfaceApp(), {
      title: 'PPT Live',
      intent: { kind: 'resume_last' },
    });

    expect(mocks.openProductAppRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'builtin-ppt-live' }),
      expect.objectContaining({
        title: 'PPT Live',
        workMode: 'resume',
      }),
    );
  });

  it('maps an existing-object intent and preserves the selected source Work', async () => {
    const sourceWorkLocator = {
      scope: { kind: 'workspace' as const, workspaceId: 'ws_project' },
      workId: 'work-source',
    };

    await launchActiveIntelligentApp(applicationSurfaceApp(), {
      title: 'Presentation',
      intent: { kind: 'create_for_existing_object', sourceWorkLocator },
    });

    expect(mocks.openProductAppRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'builtin-ppt-live' }),
      expect.objectContaining({
        title: 'Presentation',
        workMode: 'existing_object',
        sourceWorkLocator,
      }),
    );
  });
});
