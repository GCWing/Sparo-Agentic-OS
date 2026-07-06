import { describe, expect, it } from 'vitest';
import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import { mergeProductAppLibrary, productAppLibraryKey } from './productAppLibrary';

function app(overrides: Partial<ProductAppCatalogEntry>): ProductAppCatalogEntry {
  return {
    id: 'builtin-remotion-live',
    version: '19.0.0',
    name: 'Remotion Live',
    description: 'Preview and render Remotion compositions.',
    interactionModel: 'interactiveWorkspace',
    workMultiplicity: 'singleton',
    workObjectKinds: [],
    dataLifecycle: null,
    truthSource: null,
    primarySurface: { componentId: 'builtin-remotion-live-surface', surfaceId: 'primary' },
    primarySurfaceMode: 'immersivePrimary',
    components: [],
    componentLockId: 'lock',
    componentLockDigest: 'sha256:lock-installed',
    permissions: {},
    installScope: 'system',
    catalogVisibility: 'discoverable',
    enabled: true,
    icon: { kind: 'monogram', label: 'Remotion Live' },
    category: 'creative',
    tags: [],
    launch: {
      kind: 'applicationSurface',
      targetId: 'builtin-remotion-live-surface',
      scopeRequirement: 'workspaceRequired',
      surfaceId: 'primary',
    },
    dependencySummary: '',
    installed: false,
    discoverable: false,
    librarySources: [],
    management: { origin: 'hidden', actions: [] },
    ...overrides,
  };
}

describe('productAppLibrary', () => {
  it('merges installed and update-source projections into one management entry', () => {
    const installed = app({
      componentLockDigest: 'sha256:lock-installed',
      packageDigest: 'sha256:package-installed',
      installed: true,
      librarySources: ['installed'],
      catalogSource: {
        kind: 'installedPackage',
        label: 'Installed package',
        packageUri: 'product-app://builtin-remotion-live@19.0.0',
      },
      management: { origin: 'installedPackage', actions: ['disable'] },
    });
    const updateSource = app({
      componentLockDigest: 'sha256:lock-available',
      packageDigest: 'sha256:package-available',
      updateAvailable: true,
      installedComponentLockDigest: 'sha256:lock-installed',
      availableComponentLockDigest: 'sha256:lock-available',
      installedPackageDigest: 'sha256:package-installed',
      availablePackageDigest: 'sha256:package-available',
      catalogSource: {
        kind: 'builtinMarketplace',
        label: 'Built-in marketplace source',
        packageUri: 'product-app://builtin-remotion-live@19.0.0',
      },
      management: { origin: 'updateSource', actions: ['update'] },
      catalogReleaseId: 'release-remotion-19',
    });

    const merged = mergeProductAppLibrary({
      installed: [installed],
      discoverable: [updateSource],
    });

    expect(merged).toHaveLength(1);
    expect(productAppLibraryKey(merged[0])).toBe('builtin-remotion-live@19.0.0');
    expect(merged[0]).toMatchObject({
      installed: true,
      discoverable: false,
      updateAvailable: true,
      componentLockDigest: 'sha256:lock-installed',
      installedComponentLockDigest: 'sha256:lock-installed',
      availableComponentLockDigest: 'sha256:lock-available',
      installedPackageDigest: 'sha256:package-installed',
      availablePackageDigest: 'sha256:package-available',
      catalogReleaseId: 'release-remotion-19',
      catalogSource: { kind: 'installedPackage' },
      management: { origin: 'installedPackage' },
    });
    expect(merged[0].management?.actions).toEqual(expect.arrayContaining(['disable', 'update']));
    expect(merged[0].librarySources).toEqual(expect.arrayContaining(['installed', 'discoverable']));
  });

  it('keeps different app versions as separate entries', () => {
    const merged = mergeProductAppLibrary({
      installed: [app({ version: '19.0.0', installed: true })],
      discoverable: [app({ version: '20.0.0', discoverable: true })],
    });

    expect(merged.map(productAppLibraryKey).sort()).toEqual([
      'builtin-remotion-live@19.0.0',
      'builtin-remotion-live@20.0.0',
    ]);
  });
});
