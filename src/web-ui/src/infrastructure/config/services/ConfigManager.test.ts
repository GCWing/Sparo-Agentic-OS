import { describe, expect, it, vi } from 'vitest';
import { ConfigCatalogStore } from '../catalog/ConfigCatalogStore';
import type { ConfigCatalog, ConfigStoredValue, SettingDescriptor } from '../catalog/types';
import { ConfigSnapshotStore } from '../snapshot/ConfigSnapshotStore';
import type { ConfigSnapshot, ConfigSnapshotUpdate } from '../snapshot/types';
import {
  ConfigConfirmationRejectedError,
  ConfigConfirmationRequiredError,
} from '../transaction/ConfigTransactionClient';
import type { ConfigCommit, ConfigCommittedEvent, ConfigPlan } from '../transaction/types';
import {
  ConfigManagerImpl,
  type ConfigManagerDependencies,
} from './ConfigManager';

function descriptor(
  id: string,
  sensitivity: SettingDescriptor['policy']['sensitivity'] = 'public',
  defaultValue?: ConfigStoredValue,
): SettingDescriptor {
  const secret = sensitivity === 'secret';
  return {
    id,
    exposure: 'formal',
    valueSchema: { type: 'string' },
    defaultValue: defaultValue ?? (secret
      ? { kind: 'secret', configured: false }
      : { kind: 'value', value: '' }),
    presentation: {
      categoryId: 'advanced',
      tabId: 'test',
      sectionId: 'test',
      fieldId: id,
      titleKey: id,
      control: 'text',
      order: 0,
      hidden: false,
    },
    ai: { aliases: [], tags: [], readable: true, writable: !secret },
    policy: {
      risk: secret ? 'elevated' : 'safe',
      sensitivity,
      mutability: 'writable',
      applyStrategy: secret ? 'manualOnly' : 'reactive',
    },
    source: { kind: 'core' },
  };
}

function plan(requiresConfirmation = false): ConfigPlan {
  return {
    planId: 'plan-1',
    baseRevision: 3,
    catalogVersion: 'catalog-1',
    operationHash: 'hash',
    expiresAtMs: Date.now() + 10_000,
    changes: [],
    requiresConfirmation,
    affectedSections: [],
    warnings: [],
  };
}

function commit(revision: number): ConfigCommit {
  return {
    commitId: 'commit-1',
    revision,
    status: 'applied',
    scope: { kind: 'user' },
    source: { kind: 'manual' },
    changes: [],
    applyReceipts: [],
    affectedSections: [],
    restartRequired: [],
    undoToken: null,
    committedAt: new Date().toISOString(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function snapshotValue(
  revision: number,
  value: string,
  catalogVersion = 'catalog-1',
): ConfigSnapshot {
  return {
    revision,
    catalogVersion,
    scope: { kind: 'user' },
    values: { 'core.test.value': { kind: 'value', value } },
  };
}

function committedValue(
  revision: number,
  value: string,
  catalogVersion = 'catalog-1',
): ConfigCommittedEvent {
  return {
    commitId: `commit-${revision}`,
    revision,
    catalogVersion,
    scope: { kind: 'user' },
    source: { kind: 'system', surface: 'test' },
    changes: [{
      settingId: 'core.test.value',
      oldValue: { kind: 'value', value: `value-${revision - 1}` },
      newValue: { kind: 'value', value },
      applyStrategy: 'reactive',
    }],
    affectedSections: [],
    committedAt: '2026-07-14T00:00:00Z',
  };
}

function createHarness({
  settings,
  values,
  planned = plan(),
  committed = commit(3),
  refreshedRevision = committed.revision,
}: {
  settings: SettingDescriptor[];
  values: Record<string, ConfigStoredValue>;
  planned?: ConfigPlan;
  committed?: ConfigCommit;
  refreshedRevision?: number;
}) {
  const catalog: ConfigCatalog = { version: 'catalog-1', settings };
  let snapshot: ConfigSnapshot = {
    revision: 3,
    catalogVersion: catalog.version,
    scope: { kind: 'user' },
    values,
  };
  const load = vi.fn(async () => catalog);
  const ensureVersion = vi.fn(async () => catalog);
  const start = vi.fn(async () => snapshot);
  const refresh = vi.fn(async () => {
    snapshot = { ...snapshot, revision: refreshedRevision };
    return snapshot;
  });
  let acceptedListener: ((update: ConfigSnapshotUpdate) => void) | null = null;
  const subscribeAccepted = vi.fn((listener: (update: ConfigSnapshotUpdate) => void) => {
    acceptedListener = listener;
    return () => {
      if (acceptedListener === listener) {
        acceptedListener = null;
      }
    };
  });
  const planConfig = vi.fn(async () => planned);
  const commitConfig = vi.fn(async () => committed);
  const dependencies: ConfigManagerDependencies = {
    catalog: { load, ensureVersion },
    snapshot: {
      getState: () => ({
        status: 'ready',
        snapshot,
        isRefreshing: false,
        error: null,
      }),
      start,
      refresh,
      subscribeAccepted,
    },
    transaction: { plan: planConfig, commit: commitConfig },
  };
  return {
    manager: new ConfigManagerImpl(dependencies),
    load,
    ensureVersion,
    start,
    refresh,
    acceptSnapshot(
      revision: number,
      nextValues: Record<string, ConfigStoredValue>,
      catalogVersion = catalog.version,
    ) {
      const previous = snapshot;
      snapshot = { ...snapshot, revision, catalogVersion, values: nextValues };
      const settingIds = new Set([
        ...Object.keys(previous.values),
        ...Object.keys(nextValues),
      ]);
      acceptedListener?.({
        previous,
        snapshot,
        changedSettingIds: [...settingIds].filter(
          (settingId) => JSON.stringify(previous.values[settingId])
            !== JSON.stringify(nextValues[settingId]),
        ),
      });
    },
    planConfig,
    commitConfig,
  };
}

describe('ConfigManagerImpl', () => {
  it('reads exact values and rebuilds public subtrees without exposing secrets', async () => {
    const harness = createHarness({
      settings: [
        descriptor('core.editor.font_size'),
        descriptor('core.editor.word_wrap'),
        descriptor('core.ai.proxy.host'),
        descriptor('core.ai.proxy.password', 'secret'),
      ],
      values: {
        'core.editor.font_size': { kind: 'value', value: 15 },
        'core.editor.word_wrap': { kind: 'value', value: true },
        'core.ai.proxy.host': { kind: 'value', value: 'http://localhost:8080' },
        'core.ai.proxy.password': { kind: 'secret', configured: true, maskedSuffix: 'cret' },
      },
    });

    await expect(harness.manager.getSetting('core.editor.font_size')).resolves.toBe(15);
    await expect(harness.manager.getSetting('core.editor')).resolves.toEqual({
      font_size: 15,
      word_wrap: true,
    });
    await expect(harness.manager.getSetting('core.ai.proxy')).resolves.toEqual({
      host: 'http://localhost:8080',
    });
    await expect(harness.manager.getSetting('core.ai.proxy.password')).resolves.toBeUndefined();
  });

  it('reads sanitized model metadata only from the authoritative snapshot', async () => {
    const models = [{ id: 'model-1', api_key: { configured: true }, enabled: true }];
    const harness = createHarness({
      settings: [descriptor('core.ai.models')],
      values: { 'core.ai.models': { kind: 'value', value: models } },
    });

    await expect(harness.manager.getSetting('core.ai.models')).resolves.toEqual(models);
    expect(harness.load).toHaveBeenCalledOnce();
    expect(harness.start).toHaveBeenCalledOnce();
  });

  it('rejects an accepted snapshot missing a Catalog setting', async () => {
    const harness = createHarness({
      settings: [
        descriptor(
          'core.app.ai_experience.enable_daily_letter',
          'public',
          { kind: 'value', value: true },
        ),
        descriptor(
          'core.app.ai_experience.voice_input.default_language',
          'public',
          { kind: 'value', value: 'auto' },
        ),
      ],
      values: {},
    });

    await expect(harness.manager.getSetting('core.app.ai_experience')).rejects.toThrow(
      'Accepted config snapshot revision 3 is missing Catalog setting',
    );
  });

  it('projects the complete BitFun Coder debug namespace from the accepted snapshot', async () => {
    const javascriptTemplate = {
      language: 'javascript',
      display_name: 'JavaScript / TypeScript',
      enabled: false,
      instrumentation_template: 'fetch(...)',
      region_start: '// #region agent log',
      region_end: '// #endregion',
      notes: ['Send logs to the ingest server.'],
    };
    const harness = createHarness({
      settings: [
        descriptor(
          'core.product_apps.bitfun_coder.debug.log_path',
          'public',
          { kind: 'value', value: '.sparo_os/debug.log' },
        ),
        descriptor(
          'core.product_apps.bitfun_coder.debug.ingest_port',
          'public',
          { kind: 'value', value: 7242 },
        ),
        descriptor(
          'core.product_apps.bitfun_coder.debug.enabled_languages',
          'public',
          { kind: 'value', value: [] },
        ),
        descriptor(
          'core.product_apps.bitfun_coder.debug.language_templates',
          'public',
          { kind: 'value', value: { javascript: javascriptTemplate } },
        ),
      ],
      values: {
        'core.product_apps.bitfun_coder.debug.log_path': {
          kind: 'value',
          value: '.sparo_os/debug.log',
        },
        'core.product_apps.bitfun_coder.debug.ingest_port': { kind: 'value', value: 7242 },
        'core.product_apps.bitfun_coder.debug.enabled_languages': { kind: 'value', value: [] },
        'core.product_apps.bitfun_coder.debug.language_templates': {
          kind: 'value',
          value: { javascript: javascriptTemplate },
        },
      },
    });

    await expect(
      harness.manager.getSetting('core.product_apps.bitfun_coder.debug'),
    ).resolves.toEqual({
      enabled_languages: [],
      ingest_port: 7242,
      language_templates: { javascript: javascriptTemplate },
      log_path: '.sparo_os/debug.log',
    });
  });

  it('publishes watch callbacks from an accepted gap-refresh snapshot diff', async () => {
    const harness = createHarness({
      settings: [descriptor('core.test.value')],
      values: { 'core.test.value': { kind: 'value', value: 'value-3' } },
    });
    const onChange = vi.fn();
    const onNamespaceChange = vi.fn();
    harness.manager.onSettingChange(onChange);
    harness.manager.watch('core.test', onNamespaceChange);

    harness.acceptSnapshot(6, {
      'core.test.value': { kind: 'value', value: 'value-6' },
    });

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(onChange).toHaveBeenCalledWith('core.test.value', 'value-3', 'value-6');
    expect(onNamespaceChange).toHaveBeenCalledOnce();
    expect(harness.ensureVersion).toHaveBeenCalledWith('catalog-1');
  });

  it('serializes accepted snapshot notifications so listeners never observe values backwards', async () => {
    const harness = createHarness({
      settings: [descriptor('core.test.value')],
      values: { 'core.test.value': { kind: 'value', value: 'value-3' } },
    });
    const onChange = vi.fn();
    harness.manager.onSettingChange(onChange);

    harness.acceptSnapshot(4, {
      'core.test.value': { kind: 'value', value: 'value-4' },
    });
    harness.acceptSnapshot(5, {
      'core.test.value': { kind: 'value', value: 'value-5' },
    });

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(onChange.mock.calls).toEqual([
      ['core.test.value', 'value-3', 'value-4'],
      ['core.test.value', 'value-4', 'value-5'],
    ]);
  });

  it('keeps business watchers monotonic across duplicate, out-of-order, and gap events', async () => {
    const firstGapRefresh = deferred<ConfigSnapshot>();
    const getConfigSnapshot = vi.fn()
      .mockResolvedValueOnce(snapshotValue(1, 'value-1'))
      .mockReturnValueOnce(firstGapRefresh.promise)
      .mockResolvedValueOnce(snapshotValue(5, 'value-5', 'catalog-2'));
    let emit!: (event: ConfigCommittedEvent) => void;
    const snapshotStore = new ConfigSnapshotStore({
      getConfigSnapshot,
      onConfigCommitted: (callback) => {
        emit = callback;
        return vi.fn();
      },
      onConfigSnapshotRefreshed: () => vi.fn(),
    });
    const setting = descriptor('core.test.value');
    const describeConfigCatalog = vi.fn()
      .mockResolvedValueOnce({ version: 'catalog-1', settings: [setting] })
      .mockResolvedValueOnce({ version: 'catalog-2', settings: [setting] });
    const catalogStore = new ConfigCatalogStore(
      { describeConfigCatalog },
      () => snapshotStore,
    );
    const manager = new ConfigManagerImpl({
      catalog: catalogStore,
      snapshot: snapshotStore,
      transaction: {
        plan: vi.fn(async () => plan()),
        commit: vi.fn(async () => commit(1)),
      },
    });
    const onChange = vi.fn();
    const onWatch = vi.fn();
    manager.onSettingChange(onChange);
    manager.watch('core.test', onWatch);

    await expect(manager.getSetting('core.test.value')).resolves.toBe('value-1');

    emit(committedValue(3, 'value-3'));
    emit(committedValue(2, 'value-2'));
    firstGapRefresh.resolve(snapshotValue(1, 'value-1'));

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    emit(committedValue(2, 'duplicate-2'));
    emit(committedValue(3, 'duplicate-3'));
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledTimes(2);

    emit(committedValue(5, 'event-value-5', 'catalog-2'));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(3));

    expect(onChange.mock.calls).toEqual([
      ['core.test.value', 'value-1', 'value-2'],
      ['core.test.value', 'value-2', 'value-3'],
      ['core.test.value', 'value-3', 'value-5'],
    ]);
    expect(onWatch).toHaveBeenCalledTimes(3);
    expect(snapshotStore.getState().snapshot).toEqual(
      snapshotValue(5, 'value-5', 'catalog-2'),
    );
    expect(describeConfigCatalog).toHaveBeenCalledTimes(2);
  });

  it('rebases model updates on the snapshot used by the transaction plan', async () => {
    const models = [{ id: 'model-1', api_key: { configured: true }, enabled: true }];
    const harness = createHarness({
      settings: [descriptor('core.ai.models')],
      values: { 'core.ai.models': { kind: 'value', value: models } },
    });
    const updater = vi.fn((current: typeof models | undefined) => (
      (current ?? []).map((model) => ({ ...model, enabled: false }))
    ));

    await harness.manager.updateSetting('core.ai.models', updater);

    expect(updater).toHaveBeenCalledWith(models);
    expect(harness.planConfig).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 3,
      operations: [{
        op: 'set',
        settingId: 'core.ai.models',
        value: [{ id: 'model-1', api_key: { configured: true }, enabled: false }],
      }],
    }));
  });

  it('omits undefined optional model properties using JSON object semantics', async () => {
    const harness = createHarness({
      settings: [descriptor('core.ai.models')],
      values: { 'core.ai.models': { kind: 'value', value: [] } },
    });

    await harness.manager.setSetting('core.ai.models', [{
      id: 'model-1',
      enabled: true,
      reasoning_effort: undefined,
      nested: {
        configured: true,
        optional: undefined,
      },
    }]);

    expect(harness.planConfig).toHaveBeenCalledWith(expect.objectContaining({
      operations: [{
        op: 'set',
        settingId: 'core.ai.models',
        value: [{
          id: 'model-1',
          enabled: true,
          nested: { configured: true },
        }],
      }],
    }));
  });

  it('rejects undefined array elements instead of silently changing their positions', async () => {
    const harness = createHarness({
      settings: [descriptor('core.ai.models')],
      values: { 'core.ai.models': { kind: 'value', value: [] } },
    });

    await expect(
      harness.manager.setSetting('core.ai.models', [
        { id: 'model-1', enabled: true },
        undefined,
      ]),
    ).rejects.toThrow('core.ai.models[1]');
    expect(harness.planConfig).not.toHaveBeenCalled();
  });

  it('writes only covered subtree descriptors and preserves omitted or redacted secrets', async () => {
    const harness = createHarness({
      settings: [
        descriptor('core.ai.proxy.host'),
        descriptor('core.ai.proxy.port'),
        descriptor('core.ai.proxy.password', 'secret'),
      ],
      values: {
        'core.ai.proxy.host': { kind: 'value', value: 'old-host' },
        'core.ai.proxy.port': { kind: 'value', value: 8080 },
        'core.ai.proxy.password': { kind: 'secret', configured: true },
      },
    });

    await harness.manager.setSetting('core.ai.proxy', {
      host: 'new-host',
      password: { configured: true },
    });

    expect(harness.planConfig).toHaveBeenCalledOnce();
    const request = harness.planConfig.mock.calls[0][0];
    expect(request.operations).toEqual([
      { op: 'set', settingId: 'core.ai.proxy.host', value: 'new-host' },
    ]);
    expect(request.expectedRevision).toBe(3);
    expect(request).not.toHaveProperty('source');
    expect(request).not.toHaveProperty('surface');
    expect(request.idempotencyKey).toEqual(expect.any(String));
    expect(harness.commitConfig).toHaveBeenCalledWith({
      planId: 'plan-1',
      expectedRevision: 3,
      idempotencyKey: request.idempotencyKey,
      confirmed: false,
    });
  });

  it('requires explicit confirmation and refreshes the snapshot to the commit revision', async () => {
    const harness = createHarness({
      settings: [descriptor('core.ai.computer_use_enabled')],
      values: { 'core.ai.computer_use_enabled': { kind: 'value', value: false } },
      planned: plan(true),
      committed: commit(4),
      refreshedRevision: 4,
    });

    await expect(
      harness.manager.setSetting('core.ai.computer_use_enabled', true),
    ).rejects.toBeInstanceOf(ConfigConfirmationRequiredError);
    expect(harness.commitConfig).not.toHaveBeenCalled();

    await harness.manager.setSetting(
      'core.ai.computer_use_enabled',
      true,
      { confirmed: true },
    );

    expect(harness.commitConfig).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'plan-1',
      expectedRevision: 3,
      confirmed: true,
    }));
    expect(harness.refresh).toHaveBeenCalledOnce();
    expect(harness.ensureVersion).toHaveBeenLastCalledWith('catalog-1');
  });

  it('uses the settings confirmation boundary without bypassing a protected plan', async () => {
    const rejected = createHarness({
      settings: [descriptor('core.ai.computer_use_enabled')],
      values: { 'core.ai.computer_use_enabled': { kind: 'value', value: false } },
      planned: plan(true),
    });
    const rejectHandler = vi.fn(async () => false);
    rejected.manager.setConfirmationHandler(rejectHandler);

    await expect(
      rejected.manager.setSetting('core.ai.computer_use_enabled', true),
    ).rejects.toBeInstanceOf(ConfigConfirmationRejectedError);
    expect(rejectHandler).toHaveBeenCalledOnce();
    expect(rejected.commitConfig).not.toHaveBeenCalled();

    const accepted = createHarness({
      settings: [descriptor('core.ai.computer_use_enabled')],
      values: { 'core.ai.computer_use_enabled': { kind: 'value', value: false } },
      planned: plan(true),
    });
    accepted.manager.setConfirmationHandler(async () => true);
    await accepted.manager.setSetting('core.ai.computer_use_enabled', true);
    expect(accepted.commitConfig).toHaveBeenCalledWith(expect.objectContaining({
      confirmed: true,
    }));
  });

  it('requires a setting ID for reset and resets a namespace by stable setting IDs', async () => {
    const harness = createHarness({
      settings: [
        descriptor('core.editor.font_size'),
        descriptor('core.editor.word_wrap'),
      ],
      values: {
        'core.editor.font_size': { kind: 'value', value: 15 },
        'core.editor.word_wrap': { kind: 'value', value: true },
      },
    });

    await expect(harness.manager.resetSetting(' ')).rejects.toThrow(
      'A non-empty Catalog setting ID or namespace is required',
    );
    await expect(harness.manager.resetSetting('editor')).rejects.toThrow(
      'ConfigManager accepts only stable Catalog setting IDs or namespaces',
    );
    await harness.manager.resetSetting('core.editor');

    expect(harness.planConfig).toHaveBeenCalledWith(expect.objectContaining({
      operations: [
        { op: 'reset', settingId: 'core.editor.font_size' },
        { op: 'reset', settingId: 'core.editor.word_wrap' },
      ],
    }));
  });
});
