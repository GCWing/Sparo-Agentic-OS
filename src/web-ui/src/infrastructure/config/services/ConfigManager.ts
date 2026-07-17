import { createLogger } from '@/shared/utils/logger';
import { configCatalogStore } from '../catalog/ConfigCatalogStore';
import type {
  ConfigCatalog,
  ConfigStoredValue,
  JsonValue,
  SettingDescriptor,
} from '../catalog/types';
import { configSnapshotStore } from '../snapshot/ConfigSnapshotStore';
import type {
  ConfigSnapshot,
  ConfigSnapshotState,
  ConfigSnapshotUpdate,
} from '../snapshot/types';
import {
  ConfigConfirmationRejectedError,
  ConfigConfirmationRequiredError,
  configTransactionClient,
  createConfigRequestId,
} from '../transaction/ConfigTransactionClient';
import type {
  ConfigCommit,
  ConfigPatchOperation,
  ConfigPlan,
  PlanConfigPatchRequest,
} from '../transaction/types';
import type {
  ConfigManagerWriteOptions,
  IConfigManager,
} from '../types';

const log = createLogger('ConfigManager');

type ConfigChangeListener = (settingId: string, oldValue: unknown, newValue: unknown) => void;
export type ConfigManagerConfirmationHandler = (
  error: ConfigConfirmationRequiredError,
) => Promise<boolean>;

interface CatalogReader {
  load(force?: boolean): Promise<ConfigCatalog>;
  ensureVersion(catalogVersion: string): Promise<ConfigCatalog>;
}

interface SnapshotReader {
  getState(): ConfigSnapshotState;
  start(): Promise<ConfigSnapshot>;
  refresh(): Promise<ConfigSnapshot>;
  subscribeAccepted(listener: (update: ConfigSnapshotUpdate) => void): () => void;
}

interface TransactionWriter {
  plan(request: PlanConfigPatchRequest): Promise<ConfigPlan>;
  commit(request: {
    planId: string;
    expectedRevision: number;
    idempotencyKey: string;
    confirmed: boolean;
  }): Promise<ConfigCommit>;
}

export interface ConfigManagerDependencies {
  catalog: CatalogReader;
  snapshot: SnapshotReader;
  transaction: TransactionWriter;
}

const DEFAULT_DEPENDENCIES: ConfigManagerDependencies = {
  get catalog() {
    return configCatalogStore;
  },
  get snapshot() {
    return configSnapshotStore;
  },
  get transaction() {
    return configTransactionClient;
  },
};

function exposeStoredValue(value: ConfigStoredValue): unknown {
  return value.kind === 'value'
    ? cloneJsonValue(value.value)
    : { configured: value.configured, provider: value.provider, maskedSuffix: value.maskedSuffix };
}

function requireSnapshotValue(snapshot: ConfigSnapshot, settingId: string): ConfigStoredValue {
  const value = snapshot.values[settingId];
  if (!value) {
    throw new Error(
      `Accepted config snapshot revision ${snapshot.revision} is missing Catalog setting "${settingId}"`,
    );
  }
  return value;
}

function cloneJsonValue<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
    ) as T;
  }
  return value;
}

function toJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Config value at "${path}" must be a finite number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toJsonValue(item, `${path}[${index}]`));
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) {
        continue;
      }
      result[key] = toJsonValue(child, `${path}.${key}`);
    }
    return result;
  }
  throw new Error(`Config value at "${path}" is not JSON serializable`);
}

function readRelativeValue(
  value: unknown,
  relativePath: string,
): { found: boolean; value?: unknown } {
  let current = value;
  for (const segment of relativePath.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      return { found: false };
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

function writeRelativeValue(target: Record<string, JsonValue>, path: string, value: JsonValue): void {
  const segments = path.split('.');
  let current = target;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = cloneJsonValue(value);
      return;
    }

    const existing = current[segment];
    if (existing === null || Array.isArray(existing) || typeof existing !== 'object') {
      current[segment] = {};
    }
    current = current[segment] as Record<string, JsonValue>;
  });
}

function isRedactedSecretValue(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return typeof record.configured === 'boolean'
    && keys.every((key) => key === 'configured' || key === 'provider' || key === 'maskedSuffix');
}

function descriptorsAtOrBelow(catalog: ConfigCatalog, settingId: string): SettingDescriptor[] {
  const prefix = `${settingId}.`;
  return catalog.settings
    .filter((descriptor) => descriptor.id === settingId || descriptor.id.startsWith(prefix))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Projects one stable setting ID or setting namespace from an accepted snapshot. */
export function projectSettingValue<T>(
  catalog: ConfigCatalog,
  snapshot: ConfigSnapshot,
  settingId: string,
): T {
  const descriptors = descriptorsAtOrBelow(catalog, settingId);
  const exact = descriptors.find((descriptor) => descriptor.id === settingId);
  if (exact) {
    const stored = requireSnapshotValue(snapshot, exact.id);
    return (stored.kind === 'value' ? cloneJsonValue(stored.value) : undefined) as T;
  }

  if (descriptors.length === 0) {
    throw new Error(`No Catalog setting matches ID or namespace "${settingId}"`);
  }

  const projected: Record<string, JsonValue> = {};
  let found = false;
  for (const descriptor of descriptors) {
    const stored = requireSnapshotValue(snapshot, descriptor.id);
    if (stored.kind !== 'value') {
      continue;
    }
    const relativePath = descriptor.id.slice(settingId.length + 1);
    writeRelativeValue(projected, relativePath, stored.value);
    found = true;
  }

  return (found ? projected : undefined) as T;
}

/**
 * Stable setting-ID projection over the authoritative catalog, snapshot, and
 * transaction protocol. It deliberately owns no configuration cache.
 */
export class ConfigManagerImpl implements IConfigManager {
  private readonly listeners = new Set<ConfigChangeListener>();
  private readonly settingListeners = new Map<string, Set<() => void>>();
  private writeTail: Promise<void> = Promise.resolve();
  private notificationTail: Promise<void> = Promise.resolve();
  private snapshotUnlisten: (() => void) | null = null;
  private confirmationHandler: ConfigManagerConfirmationHandler | null = null;

  constructor(private readonly dependencies: ConfigManagerDependencies = DEFAULT_DEPENDENCIES) {}

  private ensureSnapshotSubscription(): void {
    if (this.snapshotUnlisten) {
      return;
    }
    this.snapshotUnlisten = this.dependencies.snapshot.subscribeAccepted((update) => {
      if (!update.previous || update.changedSettingIds.length === 0) {
        return;
      }
      this.notificationTail = this.notificationTail
        .then(() => this.publishAcceptedSnapshotUpdate(update))
        .catch((error: unknown) => {
          log.error('Failed to publish accepted config snapshot update', {
            revision: update.snapshot.revision,
            error,
          });
        });
    });
  }

  async getSetting<T = unknown>(settingId: string): Promise<T> {
    const normalizedSettingId = this.requireSettingId(settingId);
    try {
      const { catalog, snapshot } = await this.loadAuthoritativeState();
      return projectSettingValue<T>(catalog, snapshot, normalizedSettingId);
    } catch (error) {
      log.error('Failed to get setting', { settingId: normalizedSettingId, error });
      throw error;
    }
  }

  async setSetting<T = unknown>(
    settingId: string,
    value: T,
    options: ConfigManagerWriteOptions = {},
  ): Promise<void> {
    const normalizedSettingId = this.requireSettingId(settingId);
    try {
      await this.enqueueWrite(async () => {
        const state = await this.loadAuthoritativeState();
        const operations = this.buildSetOperations(state.catalog, normalizedSettingId, value);
        await this.applyOperations(state.snapshot, operations, options);
      });
    } catch (error) {
      if (
        !(error instanceof ConfigConfirmationRequiredError)
        && !(error instanceof ConfigConfirmationRejectedError)
      ) {
        log.error('Failed to set setting', { settingId: normalizedSettingId, error });
      }
      throw error;
    }
  }

  /**
   * Applies a read-modify-write operation inside the serialized transaction
   * queue. The updater always receives the latest authoritative snapshot used
   * for planning, so callers cannot accidentally rebase stale component state
   * onto a newer revision.
   */
  async updateSetting<TCurrent = unknown, TNext = TCurrent>(
    settingId: string,
    updater: (current: TCurrent | undefined) => TNext,
    options: ConfigManagerWriteOptions = {},
  ): Promise<void> {
    const normalizedSettingId = this.requireSettingId(settingId);
    try {
      await this.enqueueWrite(async () => {
        const state = await this.loadAuthoritativeState();
        const current = projectSettingValue<TCurrent>(
          state.catalog,
          state.snapshot,
          normalizedSettingId,
        );
        const next = updater(current);
        const operations = this.buildSetOperations(state.catalog, normalizedSettingId, next);
        await this.applyOperations(state.snapshot, operations, options);
      });
    } catch (error) {
      if (
        !(error instanceof ConfigConfirmationRequiredError)
        && !(error instanceof ConfigConfirmationRejectedError)
      ) {
        log.error('Failed to update setting', { settingId: normalizedSettingId, error });
      }
      throw error;
    }
  }

  async resetSetting(settingId: string, options: ConfigManagerWriteOptions = {}): Promise<void> {
    const normalizedSettingId = this.requireSettingId(settingId);
    try {
      await this.enqueueWrite(async () => {
        const state = await this.loadAuthoritativeState();
        const descriptors = descriptorsAtOrBelow(state.catalog, normalizedSettingId);
        if (descriptors.length === 0) {
          throw new Error(`No Catalog setting matches ID or namespace "${normalizedSettingId}"`);
        }
        await this.applyOperations(
          state.snapshot,
          descriptors.map((descriptor) => ({ op: 'reset', settingId: descriptor.id })),
          options,
        );
      });
    } catch (error) {
      if (
        !(error instanceof ConfigConfirmationRequiredError)
        && !(error instanceof ConfigConfirmationRejectedError)
      ) {
        log.error('Failed to reset setting', { settingId: normalizedSettingId, error });
      }
      throw error;
    }
  }

  onSettingChange(callback: ConfigChangeListener): () => void {
    this.listeners.add(callback);
    this.ensureSnapshotSubscription();
    return () => this.listeners.delete(callback);
  }

  setConfirmationHandler(handler: ConfigManagerConfirmationHandler): () => void {
    this.confirmationHandler = handler;
    return () => {
      if (this.confirmationHandler === handler) {
        this.confirmationHandler = null;
      }
    };
  }

  watch(settingId: string, callback: () => void): () => void {
    const normalizedSettingId = this.requireSettingId(settingId);
    const callbacks = this.settingListeners.get(normalizedSettingId) ?? new Set<() => void>();
    callbacks.add(callback);
    this.settingListeners.set(normalizedSettingId, callbacks);
    this.ensureSnapshotSubscription();
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.settingListeners.delete(normalizedSettingId);
      }
    };
  }

  private async loadAuthoritativeState(): Promise<{
    catalog: ConfigCatalog;
    snapshot: ConfigSnapshot;
  }> {
    let [catalog, snapshot] = await Promise.all([
      this.dependencies.catalog.load(),
      this.dependencies.snapshot.start(),
    ]);
    snapshot = this.dependencies.snapshot.getState().snapshot ?? snapshot;
    if (catalog.version !== snapshot.catalogVersion) {
      catalog = await this.dependencies.catalog.ensureVersion(snapshot.catalogVersion);
    }
    return { catalog, snapshot };
  }

  private enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const scheduled = this.writeTail.then(operation, operation);
    this.writeTail = scheduled.catch(() => undefined);
    return scheduled;
  }

  private buildSetOperations(
    catalog: ConfigCatalog,
    settingId: string,
    value: unknown,
  ): ConfigPatchOperation[] {
    const descriptors = descriptorsAtOrBelow(catalog, settingId);
    const exact = descriptors.find((descriptor) => descriptor.id === settingId);
    if (exact) {
      if (exact.policy.sensitivity === 'secret' && isRedactedSecretValue(value)) {
        throw new Error(`Refusing to write a redacted secret setting "${settingId}"`);
      }
      return [{ op: 'set', settingId: exact.id, value: toJsonValue(value, settingId) }];
    }
    if (descriptors.length === 0) {
      throw new Error(`No Catalog setting matches ID or namespace "${settingId}"`);
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Setting namespace "${settingId}" must be written with an object`);
    }

    const operations: ConfigPatchOperation[] = [];
    for (const descriptor of descriptors) {
      const relativePath = descriptor.id.slice(settingId.length + 1);
      const candidate = readRelativeValue(value, relativePath);
      if (!candidate.found) {
        continue;
      }
      if (descriptor.policy.sensitivity === 'secret' && isRedactedSecretValue(candidate.value)) {
        continue;
      }
      operations.push({
        op: 'set',
        settingId: descriptor.id,
        value: toJsonValue(candidate.value, descriptor.id),
      });
    }
    if (operations.length === 0) {
      throw new Error(`Setting namespace "${settingId}" does not cover a writable Catalog setting`);
    }
    return operations;
  }

  private async applyOperations(
    snapshot: ConfigSnapshot,
    operations: readonly ConfigPatchOperation[],
    options: ConfigManagerWriteOptions,
  ): Promise<void> {
    const requestId = createConfigRequestId('config-plan');
    const idempotencyKey = createConfigRequestId('config-change');
    const plan = await this.dependencies.transaction.plan({
      requestId,
      idempotencyKey,
      expectedRevision: snapshot.revision,
      scope: snapshot.scope,
      operations,
    });
    const commitRequest = {
      expectedRevision: snapshot.revision,
      idempotencyKey,
    };
    let confirmed = options.confirmed === true;
    if (plan.requiresConfirmation && !confirmed) {
      const confirmationError = new ConfigConfirmationRequiredError(plan, commitRequest);
      if (!this.confirmationHandler) {
        throw confirmationError;
      }
      confirmed = await this.confirmationHandler(confirmationError);
      if (!confirmed) {
        throw new ConfigConfirmationRejectedError();
      }
    }

    const commit = await this.dependencies.transaction.commit({
      ...commitRequest,
      planId: plan.planId,
      confirmed,
    });
    await this.synchronizeSnapshot(commit.revision);
  }

  private async synchronizeSnapshot(committedRevision: number): Promise<void> {
    let snapshot = this.dependencies.snapshot.getState().snapshot;
    if (!snapshot || snapshot.revision < committedRevision) {
      snapshot = await this.dependencies.snapshot.refresh();
    }
    if (snapshot.revision < committedRevision) {
      throw new Error(
        `Config snapshot revision ${snapshot.revision} is behind committed revision ${committedRevision}`,
      );
    }
    await this.dependencies.catalog.ensureVersion(snapshot.catalogVersion);
  }

  private async publishAcceptedSnapshotUpdate(update: ConfigSnapshotUpdate): Promise<void> {
    if (!update.previous) {
      return;
    }

    const catalog = await this.dependencies.catalog.ensureVersion(update.snapshot.catalogVersion);
    const descriptors = new Map(catalog.settings.map((descriptor) => [descriptor.id, descriptor]));
    for (const settingId of update.changedSettingIds) {
      const descriptor = descriptors.get(settingId);
      if (!descriptor) {
        throw new Error(
          `Accepted config snapshot references unknown setting "${settingId}" at revision ${update.snapshot.revision}`,
        );
      }
      const oldValue = requireSnapshotValue(update.previous, settingId);
      const newValue = requireSnapshotValue(update.snapshot, settingId);
      this.notifySettingChange(
        settingId,
        exposeStoredValue(oldValue),
        exposeStoredValue(newValue),
      );
    }
  }

  private requireSettingId(settingId: string): string {
    const normalized = settingId.trim();
    if (!normalized) {
      throw new Error('A non-empty Catalog setting ID or namespace is required');
    }
    if (normalized !== 'core' && !normalized.startsWith('core.')) {
      throw new Error(
        `ConfigManager accepts only stable Catalog setting IDs or namespaces; received "${normalized}"`,
      );
    }
    return normalized;
  }

  private notifySettingChange(settingId: string, oldValue: unknown, newValue: unknown): void {
    for (const callback of this.listeners) {
      try {
        callback(settingId, oldValue, newValue);
      } catch (error) {
        log.error('Setting change listener failed', { settingId, error });
      }
    }

    for (const [watchedSettingId, callbacks] of this.settingListeners) {
      const overlaps = settingId === watchedSettingId
        || settingId.startsWith(`${watchedSettingId}.`)
        || watchedSettingId.startsWith(`${settingId}.`);
      if (!overlaps) {
        continue;
      }
      for (const callback of callbacks) {
        try {
          callback();
        } catch (error) {
          log.error('Setting listener failed', { settingId, watchedSettingId, error });
        }
      }
    }
  }
}

export const configManager = new ConfigManagerImpl();

export default configManager;
