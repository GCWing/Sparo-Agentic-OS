import { browser, expect, $ } from '@wdio/globals';

type ManagementRowState = {
  appId: string | null;
  installed: string | null;
  discoverable: string | null;
  canDisable: string | null;
  canUninstall: string | null;
  catalogSourceKind: string | null;
};

type LibraryProbe = {
  installedCount: number;
  discoverableCount: number;
  installedIds: string[];
  discoverableIds: string[];
};

type HomeCardState = {
  appId: string | null;
  appKind: string | null;
  componentCount: string | null;
};

type ComponentProbe = {
  componentId: string;
  componentKind: string;
  healthStatus: string;
  checkCount: number;
  runtimeRunCount: number;
  runtimeFailureCount: number;
  runtimeIssueCount: number;
  runtimeWarningCount: number;
  runtimeUsageCount: number;
  diagnosticActionCount: number;
  recentFailureEvidenceCount: number;
  recentLogEvidenceCount: number;
  healthAction: string | null;
  healthActionStatus: string | null;
};

type RuntimeWorkProbe = {
  appId: string;
  appVersion: string;
  componentLockDigest: string;
  productAppSurfaceId: string;
  surfaceId: string;
  workId: string;
  reusedWorkId: string;
  secondCreated: boolean;
  workKind: string;
  subjectKind: string;
  primarySurfaceKind: string;
  runtimeInstanceCount: number;
  graphExecutionCount: number;
  graphRuntimeInstanceCount: number;
  graphRuntimeRunCount: number;
  graphRuntimeLogCount: number;
  graphArtifactCount: number;
  runtimeHostKind: string;
  runtimeStorageEcho: unknown;
};

describe('Product App system semantics', () => {
  before(async () => {
    await browser.pause(3000);
  });

  async function openAppsManage(): Promise<void> {
    await browser.execute(async () => {
      const { openWorkspaceScene } = await import('/src/app/navigation/workspaceNavigation.ts');
      const { useAppsStore } = await import('/src/app/scenes/apps/appsStore.ts');
      useAppsStore.getState().openManage();
      openWorkspaceScene('apps');
    });

    const scene = await $('[data-testid="apps-manage-scene"]');
    await scene.waitForDisplayed({ timeout: 30000 });
  }

  async function openAppsHome(): Promise<void> {
    await browser.execute(async () => {
      const { openWorkspaceScene } = await import('/src/app/navigation/workspaceNavigation.ts');
      const { useAppsStore } = await import('/src/app/scenes/apps/appsStore.ts');
      useAppsStore.getState().openHome();
      openWorkspaceScene('apps');
    });

    const scene = await $('[data-testid="apps-scene"]');
    await scene.waitForDisplayed({ timeout: 30000 });
  }

  async function openComponentCenter(componentId: string, componentKind: string): Promise<void> {
    await browser.execute(async () => {
      const { openWorkspaceScene } = await import('/src/app/navigation/workspaceNavigation.ts');
      const { useAppsStore } = await import('/src/app/scenes/apps/appsStore.ts');
      useAppsStore.getState().setComponentFilter('all');
      useAppsStore.getState().setComponentSearch('');
      useAppsStore.getState().openComponentCenter();
      openWorkspaceScene('apps');
    });

    const scene = await $('[data-testid="component-center-scene"]');
    await scene.waitForDisplayed({ timeout: 30000 });
    const card = await $(`[data-testid="component-center-card"][data-component-id="${componentId}"][data-component-kind="${componentKind}"]`);
    await card.waitForDisplayed({ timeout: 30000 });
    await card.click();
  }

  async function setProductAppFilter(filter: 'installed' | 'discover'): Promise<void> {
    await browser.execute(async (nextFilter) => {
      const { useAppsStore } = await import('/src/app/scenes/apps/appsStore.ts');
      useAppsStore.getState().setProductAppFilter(nextFilter);
    }, filter);
  }

  async function getManagementRows(): Promise<ManagementRowState[]> {
    return browser.execute(() => Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="product-app-management-row"]'),
    ).map((row) => ({
      appId: row.getAttribute('data-app-id'),
      installed: row.getAttribute('data-installed'),
      discoverable: row.getAttribute('data-discoverable'),
      canDisable: row.getAttribute('data-can-disable'),
      canUninstall: row.getAttribute('data-can-uninstall'),
      catalogSourceKind: row.getAttribute('data-catalog-source-kind'),
    })));
  }

  async function getHomeCards(): Promise<HomeCardState[]> {
    return browser.execute(() => Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="native-app-home-card"], [data-testid="product-app-home-card"]',
      ),
    ).map((row) => ({
      appId: row.getAttribute('data-app-id'),
      appKind: row.getAttribute('data-app-kind'),
      componentCount: row.getAttribute('data-component-count'),
    })));
  }

  async function waitForManagementRows(
    sourceAttribute: 'installed' | 'discoverable',
  ): Promise<ManagementRowState[]> {
    await browser.waitUntil(
      async () => {
        const rows = await getManagementRows();
        return rows.length > 0
          && rows.every((row) => row[sourceAttribute] === 'true');
      },
      {
        timeout: 30000,
        timeoutMsg: `Product App management rows did not settle for ${sourceAttribute}`,
      },
    );
    return getManagementRows();
  }

  async function ensureInstalledProductApp(): Promise<LibraryProbe> {
    return browser.execute(async () => {
      const { appCatalogAPI } = await import('/src/infrastructure/api/service-api/AppCatalogAPI.ts');
      let library = await appCatalogAPI.listProductAppLibrary();
      if (!library.installed.some((candidate) => candidate.id.startsWith('builtin-'))) {
        const app = library.discoverable.find((candidate) => candidate.id === 'builtin-spark-board')
          ?? library.discoverable.find((candidate) => candidate.id.startsWith('builtin-'))
          ?? library.discoverable.find((candidate) => candidate.launch?.kind === 'applicationSurface')
          ?? library.discoverable[0];
        if (!app) throw new Error('No discoverable Product App available to install');
        await appCatalogAPI.installProductApp(app);
        library = await appCatalogAPI.listProductAppLibrary();
      }
      const installedIds = [...new Set(library.installed.map((app) => app.id))];
      const discoverableIds = [...new Set(library.discoverable.map((app) => app.id))];
      return {
        installedCount: installedIds.length,
        discoverableCount: discoverableIds.length,
        installedIds,
        discoverableIds,
      };
    });
  }

  async function ensureInstalledApplicationSurfaceProductApp(): Promise<void> {
    await browser.execute(async () => {
      const { appCatalogAPI } = await import('/src/infrastructure/api/service-api/AppCatalogAPI.ts');
      let library = await appCatalogAPI.listProductAppLibrary();
      if (library.installed.some((candidate) => candidate.launch?.kind === 'applicationSurface')) {
        return;
      }

      const app = library.discoverable.find((candidate) => candidate.id === 'builtin-spark-board')
        ?? library.discoverable.find((candidate) => candidate.launch?.kind === 'applicationSurface');
      if (!app) throw new Error('No applicationSurface Product App available to install');
      await appCatalogAPI.installProductApp(app);
      library = await appCatalogAPI.listProductAppLibrary();
      if (!library.installed.some((candidate) => candidate.launch?.kind === 'applicationSurface')) {
        throw new Error('Installing applicationSurface Product App did not update installed catalog');
      }
    });
  }

  async function probeComponentHealth(): Promise<ComponentProbe> {
    return browser.execute(async () => {
      const { appCatalogAPI } = await import('/src/infrastructure/api/service-api/AppCatalogAPI.ts');
      const components = await appCatalogAPI.listComponents();
      const component = components.find((candidate) => (
        candidate.kind === 'bridge'
        && (candidate.capabilities ?? []).some((capability) => (
          capability.actions?.includes('health')
          || capability.actions?.includes('readDiagnostics')
          || capability.actions?.includes('getRuntimeState')
        ))
      )) ?? components[0];
      if (!component) throw new Error('No Component Center component found');

      const health = await appCatalogAPI.componentHealth(component.id, component.kind);
      const usage = await appCatalogAPI.componentUsage(component.id, component.kind);
      return {
        componentId: component.id,
        componentKind: component.kind,
        healthStatus: health.status,
        checkCount: health.checks?.length ?? 0,
        runtimeRunCount: health.runtime.recentRunCount,
        runtimeFailureCount: health.runtime.recentFailureCount,
        runtimeIssueCount: health.runtime.runtimeIssueCount,
        runtimeWarningCount: health.runtime.runtimeWarningCount,
        runtimeUsageCount: usage.runtimeUsages?.length ?? 0,
        diagnosticActionCount: health.runtime.actions?.length ?? 0,
        recentFailureEvidenceCount: health.runtime.recentFailures?.length ?? 0,
        recentLogEvidenceCount: health.runtime.recentLogs?.length ?? 0,
        healthAction: health.runtime.healthAction ?? null,
        healthActionStatus: health.runtime.healthActionStatus ?? null,
      };
    });
  }

  async function resolveRuntimeWork(): Promise<RuntimeWorkProbe> {
    await ensureInstalledApplicationSurfaceProductApp();
    return browser.execute(async () => {
      const { appCatalogAPI } = await import('/src/infrastructure/api/service-api/AppCatalogAPI.ts');
      const { agenticOsWorkApi } = await import('/src/app/agentic-os/work/data/workApi.ts');
      const { useWorkStore } = await import('/src/app/agentic-os/work/data/workStore.ts');
      const { productAppRuntimeAPI } = await import('/src/infrastructure/api/service-api/ProductAppRuntimeAPI.ts');
      const { productAppRuntimeHostAPI } = await import('/src/infrastructure/api/service-api/ProductAppRuntimeHostAPI.ts');

      const library = await appCatalogAPI.listProductAppLibrary();
      const app = library.installed.find((candidate) => candidate.id === 'builtin-spark-board')
        ?? library.installed.find((candidate) => candidate.launch?.kind === 'applicationSurface');
      if (!app) throw new Error('No installed applicationSurface Product App found');

      const surfaceId = app.primarySurface.surfaceId || 'primary';
      const appRef = {
        kind: 'product_app' as const,
        appId: app.id,
        appVersion: app.version,
        componentLockDigest: app.componentLockDigest,
      };
      const request = {
        app: appRef,
        intent: 'review' as const,
        title: `E2E Product App semantic check: ${app.name}`,
        objective: 'Verify Work-owned Product App runtime graph semantics.',
        scope: { kind: 'system' as const },
        visibility: 'primary' as const,
        primarySurfacePolicy: 'application_surface' as const,
        primarySurface: {
          kind: 'application_surface' as const,
          productAppId: app.id,
          productAppSurfaceId: app.primarySurface.componentId,
          surfaceId,
        },
        assignment: {
          kind: 'application' as const,
          applicationId: app.id,
        },
        appRefs: [{
          app: appRef,
          role: 'executor' as const,
          surfaceId,
        }],
      };

      const first = await agenticOsWorkApi.resolveAppWork(request);
      const second = await agenticOsWorkApi.resolveAppWork({
        ...request,
        title: `Resume ${request.title}`,
        objective: 'Verify the same app lock resolves to the same Work.',
      });
      const graph = await agenticOsWorkApi.getWorkExecutionGraph(first.work.id);
      await useWorkStore.getState().getWork(first.work.id);
      const runtimeInstance = first.work.runtimeInstances[0];
      if (!runtimeInstance) throw new Error('Resolved Product App Work did not create a runtime instance');
      const resolvedRuntime = await productAppRuntimeAPI.resolveProductAppRuntimeInstance({
        workId: first.work.id,
        productAppId: app.id,
        runtimeInstanceId: runtimeInstance.id,
        productAppVersion: app.version,
        componentLockDigest: app.componentLockDigest,
        productAppSurfaceId: app.primarySurface.componentId,
        surfaceId,
      });
      await productAppRuntimeHostAPI.workerCall(
        resolvedRuntime.host.surfaceId,
        'storage.set',
        { key: 'e2e-product-runtime-host', value: { ok: true, appId: app.id } },
        resolvedRuntime.runtimeContext,
      );
      const runtimeStorageEcho = await productAppRuntimeHostAPI.workerCall(
        resolvedRuntime.host.surfaceId,
        'storage.get',
        { key: 'e2e-product-runtime-host' },
        resolvedRuntime.runtimeContext,
      );

      return {
        appId: app.id,
        appVersion: app.version,
        componentLockDigest: app.componentLockDigest,
        productAppSurfaceId: app.primarySurface.componentId,
        surfaceId,
        workId: first.work.id,
        reusedWorkId: second.work.id,
        secondCreated: second.created,
        workKind: first.work.kind,
        subjectKind: first.work.subject.kind,
        primarySurfaceKind: first.work.primarySurface.kind,
        runtimeInstanceCount: first.work.runtimeInstances.length,
        graphExecutionCount: graph.summary.executionCount,
        graphRuntimeInstanceCount: graph.summary.runtimeInstanceCount,
        graphRuntimeRunCount: graph.summary.runtimeRunCount,
        graphRuntimeLogCount: graph.logs.length,
        graphArtifactCount: graph.summary.artifactCount,
        runtimeHostKind: resolvedRuntime.host.kind,
        runtimeStorageEcho,
      };
    });
  }

  async function seedArtifactSearchWork(): Promise<{ workId: string; artifactId: string }> {
    await ensureInstalledProductApp();
    return browser.execute(async () => {
      const { appCatalogAPI } = await import('/src/infrastructure/api/service-api/AppCatalogAPI.ts');
      const { useWorkStore } = await import('/src/app/agentic-os/work/data/workStore.ts');
      const library = await appCatalogAPI.listProductAppLibrary();
      const app = library.installed.find((candidate) => candidate.id === 'builtin-spark-board')
        ?? library.installed[0];
      if (!app) throw new Error('No Product App catalog entry found');
      const now = Date.now();
      const workId = `e2e-artifact-owner-work-${now}`;
      const artifactId = `e2e-artifact-owner-${now}`;
      const appRef = {
        kind: 'product_app' as const,
        appId: app.id,
        appVersion: app.version,
        componentLockDigest: app.componentLockDigest,
      };
      const work = {
        id: workId,
        kind: 'app_workflow' as const,
        title: `E2E artifact owner ${now}`,
        titleState: { source: 'user' as const, locked: true },
        objective: 'Verify Global Search opens artifacts through their owner Work.',
        status: 'active' as const,
        visibility: 'primary' as const,
        subject: { kind: 'app' as const, app: appRef, intent: 'review' as const },
        appRefs: [{ app: appRef, role: 'subject' as const, surfaceId: app.primarySurface.surfaceId || 'primary' }],
        scope: { kind: 'system' as const },
        primarySurface: { kind: 'work_center' as const, workId },
        surfaces: [{ kind: 'work_center' as const, workId }],
        assignment: { kind: 'application' as const, applicationId: app.id },
        lifecycle: { events: [{ status: 'active' as const, label: 'e2e seed', at: now }] },
        summary: null,
        sessionRefs: [],
        executionBindings: [],
        runtimeInstances: [],
        artifactRefs: [{
          id: artifactId,
          label: `E2E artifact owner sentinel ${now}`,
          uri: `sparo://e2e/${artifactId}`,
        }],
        memoryRefs: [],
        createdAt: now,
        updatedAt: now,
      };
      const current = useWorkStore.getState().works.filter((candidate) => candidate.id !== workId);
      useWorkStore.setState({ works: [work, ...current], loaded: true, loading: false, error: null });
      return { workId, artifactId };
    });
  }

  it('keeps Installed and Discover sources separate in Apps Center', async () => {
    const library = await ensureInstalledProductApp();
    expect(library.installedCount).toBeGreaterThan(0);
    expect(library.discoverableCount).toBeGreaterThan(0);

    await openAppsHome();
    const homeCards = await getHomeCards();
    const nativeCards = homeCards.filter((card) => card.appKind === 'native_app');
    const productCards = homeCards.filter((card) => card.appKind === 'product_app');
    expect(nativeCards.map((card) => card.appId)).toEqual(expect.arrayContaining([
      'os-agent',
      'runno',
      'app-builder',
    ]));
    expect(productCards.every((card) => card.appId !== null && library.installedIds.includes(card.appId))).toBe(true);
    expect(productCards.every((card) => Number(card.componentCount ?? '0') >= 0)).toBe(true);
    expect(await $$('[data-testid="component-center-card"]')).toHaveLength(0);
    const homeCardSizes = await Promise.all(
      (await $$('[data-testid="native-app-home-card"], [data-testid="product-app-home-card"]')).map((card) => card.getSize()),
    );
    expect(homeCardSizes.every((size) => size.width <= 300)).toBe(true);
    expect(homeCardSizes.every((size) => size.height <= 180)).toBe(true);

    await openAppsManage();
    await setProductAppFilter('installed');
    const installedRows = await waitForManagementRows('installed');
    expect(installedRows.every((row) => row.appId !== null && library.installedIds.includes(row.appId))).toBe(true);
    expect(installedRows.every((row) => row.catalogSourceKind === 'installedPackage')).toBe(true);
    const nativeLifecycleIds = [
      'os-agent',
      'runno',
      'app-builder',
    ];
    expect(installedRows.every((row) => !nativeLifecycleIds.includes(row.appId ?? ''))).toBe(true);
    const installedBuiltinRows = installedRows.filter((row) => row.appId?.startsWith('builtin-'));
    expect(installedBuiltinRows.length).toBeGreaterThan(0);
    expect(installedBuiltinRows.every((row) => row.canDisable === 'true')).toBe(true);
    expect(installedBuiltinRows.every((row) => row.canUninstall === 'false')).toBe(true);

    await setProductAppFilter('discover');
    const discoverRows = await waitForManagementRows('discoverable');
    expect(discoverRows.every((row) => row.appId !== null && library.discoverableIds.includes(row.appId))).toBe(true);
    expect(discoverRows.every((row) => row.catalogSourceKind === 'builtinMarketplace')).toBe(true);
  });

  it('renders Component Center health from contract checks and runtime counters', async () => {
    const probe = await probeComponentHealth();
    expect(probe.checkCount).toBeGreaterThan(0);

    await openComponentCenter(probe.componentId, probe.componentKind);
    const inspector = await $('[data-testid="component-inspector"]');
    await inspector.waitForDisplayed({ timeout: 30000 });
    await browser.waitUntil(
      async () => (await inspector.getAttribute('data-health-status')) !== 'checking',
      {
        timeout: 30000,
        timeoutMsg: 'Component inspector health did not settle',
      },
    );

    const healthStatus = await inspector.getAttribute('data-health-status');
    const runtimeRunCount = Number(await inspector.getAttribute('data-runtime-run-count'));
    const runtimeFailureCount = Number(await inspector.getAttribute('data-runtime-failure-count'));
    const runtimeIssueCount = Number(await inspector.getAttribute('data-runtime-issue-count'));
    const runtimeWarningCount = Number(await inspector.getAttribute('data-runtime-warning-count'));
    const runtimeUsageCount = Number(await inspector.getAttribute('data-runtime-usage-count'));
    const diagnosticActionCount = Number(await inspector.getAttribute('data-diagnostic-action-count'));
    const recentFailureEvidenceCount = Number(await inspector.getAttribute('data-recent-failure-count'));
    const recentLogEvidenceCount = Number(await inspector.getAttribute('data-recent-log-count'));
    const healthAction = await inspector.getAttribute('data-health-action');
    const healthActionStatus = await inspector.getAttribute('data-health-action-status');

    expect(await inspector.getAttribute('data-component-id')).toBe(probe.componentId);
    expect(await inspector.getAttribute('data-component-kind')).toBe(probe.componentKind);
    expect(['available', 'degraded']).toContain(healthStatus);
    expect(runtimeRunCount).toBeGreaterThanOrEqual(0);
    expect(runtimeFailureCount).toBeGreaterThanOrEqual(0);
    expect(runtimeIssueCount).toBeGreaterThanOrEqual(0);
    expect(runtimeWarningCount).toBeGreaterThanOrEqual(0);
    expect(runtimeUsageCount).toBe(probe.runtimeUsageCount);
    expect(diagnosticActionCount).toBe(probe.diagnosticActionCount);
    expect(diagnosticActionCount).toBeGreaterThan(0);
    expect(recentFailureEvidenceCount).toBe(probe.recentFailureEvidenceCount);
    expect(recentLogEvidenceCount).toBe(probe.recentLogEvidenceCount);
    expect(
      runtimeRunCount + runtimeFailureCount + runtimeIssueCount + runtimeWarningCount,
    ).toBeGreaterThan(0);
    expect(healthAction).toBe(probe.healthAction);
    expect(healthActionStatus).toBeTruthy();
  });

  it('resolves a Product App Work by app lock and exposes its execution graph in Work Center', async () => {
    const probe = await resolveRuntimeWork();
    expect(probe.secondCreated).toBe(false);
    expect(probe.reusedWorkId).toBe(probe.workId);
    expect(probe.workKind).toBe('app_workflow');
    expect(probe.subjectKind).toBe('app');
    expect(probe.primarySurfaceKind).toBe('application_surface');
    expect(probe.componentLockDigest).toContain('sha256:');
    expect(probe.runtimeInstanceCount).toBeGreaterThan(0);
    expect(probe.graphExecutionCount).toBeGreaterThan(0);
    expect(probe.graphRuntimeInstanceCount).toBeGreaterThan(0);
    expect(probe.runtimeHostKind).toBe('productAppRuntime');
    expect(probe.runtimeStorageEcho).toEqual({ ok: true, appId: probe.appId });

    await browser.execute(async (workId) => {
      const { openWorkInCenter } = await import('/src/app/agentic-os/work/navigation/openWork.ts');
      const { useWorkStore } = await import('/src/app/agentic-os/work/data/workStore.ts');
      await useWorkStore.getState().getWork(workId);
      openWorkInCenter(workId);
    }, probe.workId);

    const workCenter = await $('[data-testid="work-center-scene"]');
    await workCenter.waitForDisplayed({ timeout: 30000 });
    const graph = await $('[data-testid="work-execution-graph"]');
    await graph.waitForDisplayed({ timeout: 30000 });
    await browser.waitUntil(
      async () => Number(await graph.getAttribute('data-runtime-instance-count')) === probe.graphRuntimeInstanceCount,
      {
        timeout: 30000,
        timeoutMsg: 'Work execution graph did not render the runtime instance summary',
      },
    );

    expect(Number(await graph.getAttribute('data-execution-count'))).toBe(probe.graphExecutionCount);
    expect(Number(await graph.getAttribute('data-runtime-instance-count'))).toBe(probe.graphRuntimeInstanceCount);
    expect(Number(await graph.getAttribute('data-runtime-run-count'))).toBe(probe.graphRuntimeRunCount);
    expect(Number(await graph.getAttribute('data-runtime-log-count'))).toBe(probe.graphRuntimeLogCount);
    expect(Number(await graph.getAttribute('data-artifact-count'))).toBe(probe.graphArtifactCount);
  });

  it('opens artifact search results through their owner Work', async () => {
    const seeded = await seedArtifactSearchWork();
    const trigger = await $('[data-testid="global-search-trigger"]');
    await trigger.waitForDisplayed({ timeout: 30000 });
    await trigger.click();

    const input = await $('.sparo-search-dialog__search input');
    await input.waitForDisplayed({ timeout: 30000 });
    await input.setValue(seeded.artifactId);

    const result = await $(`[data-testid="global-search-result"][data-result-kind="artifact"][data-work-id="${seeded.workId}"][data-artifact-id="${seeded.artifactId}"]`);
    await result.waitForDisplayed({ timeout: 30000 });
    await result.click();

    const workCenter = await $('[data-testid="work-center-scene"]');
    await workCenter.waitForDisplayed({ timeout: 30000 });
    await browser.waitUntil(
      async () => (
        await workCenter.getAttribute('data-selected-work-id') === seeded.workId
        && await workCenter.getAttribute('data-selected-artifact-id') === seeded.artifactId
      ),
      {
        timeout: 30000,
        timeoutMsg: 'Global Search artifact result did not route to its owner Work',
      },
    );
  });
});
