import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppCatalogAPI } from './AppCatalogAPI';
import {
  intelligentAppAPI,
  type AppReleaseRecord,
  type IntelligentAppCatalog,
} from './IntelligentAppAPI';

function release(version: string, releaseId: string, createdAtMs: number): AppReleaseRecord {
  return {
    releaseId,
    appId: 'builtin-ppt-live',
    slotId: 'builtin-ppt-live',
    version,
    artifactDigest: `sha256:artifact-${version}`,
    componentLockDigest: `sha256:components-${version}`,
    configRevision: `sha256:config-${version}`,
    runtimeCompatibility: '>=0.1.0',
    capabilityFingerprint: 'sha256:capabilities',
    dataSchemaVersion: '1.0.0',
    runtime: {
      launch: {
        kind: 'applicationSurface',
        targetId: 'builtin-ppt-live',
        scopeRequirement: 'workspaceOptional',
        surfaceId: 'primary',
      },
      primarySurface: {
        componentId: 'builtin-ppt-live-surface',
        surfaceId: 'primary',
      },
      primarySurfaceMode: 'sidecarLinked',
      workMultiplicity: 'multiple',
      icon: { kind: 'monogram', label: 'PL' },
      category: 'productivity',
      tags: ['presentation'],
    },
    provenance: 'system',
    evaluationReportDigest: `sha256:evaluation-${version}`,
    createdAtMs,
  };
}

describe('AppCatalogAPI Product App updates', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('projects a newer bundled Release as an explicit update for an installed system app', async () => {
    const installedRelease = release('150.0.0', 'release-ppt-150-0-0', 1);
    const availableRelease = release('150.0.1', 'release-ppt-150-0-1', 2);
    const catalog: IntelligentAppCatalog = {
      slots: [{
        slotId: 'builtin-ppt-live',
        displayName: 'PPT Live',
        activation: {
          slotId: 'builtin-ppt-live',
          selectedAppId: 'builtin-ppt-live',
          activeReleaseId: installedRelease.releaseId,
          enabled: true,
        },
        variants: [{
          app: {
            appId: 'builtin-ppt-live',
            slotId: 'builtin-ppt-live',
            displayName: 'PPT Live',
            description: 'Create presentations.',
            owner: { kind: 'system' },
            createdAtMs: 1,
          },
          releases: [availableRelease, installedRelease],
          latestRelease: availableRelease,
          upstreamUpdateAvailable: false,
          state: 'active',
        }],
      }],
      drafts: [],
    };
    vi.spyOn(intelligentAppAPI, 'listCatalog').mockResolvedValue(catalog);

    const library = await new AppCatalogAPI().listProductAppLibrary({ force: true });

    expect(library.installed).toHaveLength(1);
    expect(library.installed[0]).toMatchObject({
      appId: 'builtin-ppt-live',
      version: '150.0.0',
      availableVersion: '150.0.1',
      releaseId: installedRelease.releaseId,
      availableReleaseId: availableRelease.releaseId,
      updateAvailable: true,
      installed: true,
      enabled: true,
      management: {
        actions: ['update'],
      },
    });
    expect(library.discoverable[0]).toBe(library.installed[0]);
  });
});
