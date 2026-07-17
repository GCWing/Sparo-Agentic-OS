import { configAPI } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';
import type {
  ConfigCatalog,
  ConfigScope,
  DescribeConfigCatalogRequest,
  SettingDescriptor,
} from './types';
import { configSnapshotStore } from '../snapshot/ConfigSnapshotStore';
import type {
  ConfigSnapshot,
  ConfigSnapshotState,
  ConfigSnapshotUpdate,
} from '../snapshot/types';

const log = createLogger('ConfigCatalogStore');

export interface ConfigCatalogTransport {
  describeConfigCatalog(request: DescribeConfigCatalogRequest): Promise<ConfigCatalog>;
}

export interface ConfigCatalogSnapshotSource {
  getState(): ConfigSnapshotState;
  start(): Promise<ConfigSnapshot>;
  subscribeAccepted(listener: (update: ConfigSnapshotUpdate) => void): () => void;
}

export interface ConfigCatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  catalog: ConfigCatalog | null;
  error: Error | null;
}

const INITIAL_STATE: ConfigCatalogState = {
  status: 'idle',
  catalog: null,
  error: null,
};

export class ConfigCatalogStore {
  private state: ConfigCatalogState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly descriptorIndex = new Map<string, SettingDescriptor>();
  private readonly versionLoadPromises = new Map<string, Promise<ConfigCatalog>>();
  private requestSequence = 0;
  private activeRequestSequence = 0;
  private unlisten: (() => void) | null = null;

  constructor(
    private readonly transport: ConfigCatalogTransport,
    private readonly getSnapshotSource: () => ConfigCatalogSnapshotSource,
    private readonly scope: ConfigScope = { kind: 'user' },
  ) {}

  getState = (): ConfigCatalogState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getDescriptor(settingId: string): SettingDescriptor | undefined {
    return this.descriptorIndex.get(settingId);
  }

  async load(force = false): Promise<ConfigCatalog> {
    this.ensureSnapshotSubscription();
    const snapshot = await this.getSnapshotSource().start();
    return this.loadVersion(snapshot.catalogVersion, force);
  }

  async ensureVersion(catalogVersion: string): Promise<ConfigCatalog> {
    this.ensureSnapshotSubscription();
    return this.loadVersion(catalogVersion, false);
  }

  private loadVersion(catalogVersion: string, force: boolean): Promise<ConfigCatalog> {
    if (!force && this.state.catalog?.version === catalogVersion) {
      return Promise.resolve(this.state.catalog);
    }
    const inFlight = this.versionLoadPromises.get(catalogVersion);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.requestCatalog(catalogVersion);
    this.versionLoadPromises.set(catalogVersion, promise);
    void promise.finally(() => {
      if (this.versionLoadPromises.get(catalogVersion) === promise) {
        this.versionLoadPromises.delete(catalogVersion);
      }
    }).catch(() => undefined);
    return promise;
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
  }

  private ensureSnapshotSubscription(): void {
    if (this.unlisten) {
      return;
    }
    const snapshotSource = this.getSnapshotSource();
    this.unlisten = snapshotSource.subscribeAccepted((update) => {
      void this.ensureVersion(update.snapshot.catalogVersion).catch((error: unknown) => {
        log.error('Failed to refresh config catalog for accepted snapshot', {
          revision: update.snapshot.revision,
          catalogVersion: update.snapshot.catalogVersion,
          error,
        });
      });
    });

    const snapshot = snapshotSource.getState().snapshot;
    if (snapshot) {
      void this.ensureVersion(snapshot.catalogVersion).catch((error: unknown) => {
        log.error('Failed to align config catalog with current snapshot', {
          revision: snapshot.revision,
          catalogVersion: snapshot.catalogVersion,
          error,
        });
      });
    }
  }

  private requestCatalog(targetVersion: string): Promise<ConfigCatalog> {
    const requestSequence = ++this.requestSequence;
    this.activeRequestSequence = requestSequence;
    this.updateState({
      ...this.state,
      status: 'loading',
      error: null,
    });

    return this.transport
      .describeConfigCatalog({ scope: this.scope })
      .then((catalog) => {
        if (catalog.version !== targetVersion) {
          throw new Error(
            `Config catalog version mismatch: expected ${targetVersion}, received ${catalog.version}`,
          );
        }

        const nextIndex = this.indexDescriptors(catalog);
        if (requestSequence === this.activeRequestSequence) {
          this.descriptorIndex.clear();
          nextIndex.forEach((descriptor, id) => this.descriptorIndex.set(id, descriptor));
          this.updateState({ status: 'ready', catalog, error: null });
        }
        return catalog;
      })
      .catch((error: unknown) => {
        const resolvedError = error instanceof Error ? error : new Error(String(error));
        if (requestSequence === this.activeRequestSequence) {
          this.updateState({ ...this.state, status: 'error', error: resolvedError });
        }
        log.error('Failed to load config catalog', {
          targetVersion,
          error: resolvedError,
        });
        throw resolvedError;
      });
  }

  private indexDescriptors(catalog: ConfigCatalog): Map<string, SettingDescriptor> {
    const nextIndex = new Map<string, SettingDescriptor>();
    for (const descriptor of catalog.settings) {
      if (nextIndex.has(descriptor.id)) {
        throw new Error(`Duplicate setting descriptor id: ${descriptor.id}`);
      }
      nextIndex.set(descriptor.id, descriptor);
    }
    return nextIndex;
  }

  private updateState(nextState: ConfigCatalogState): void {
    this.state = nextState;
    this.listeners.forEach((listener) => listener());
  }
}

export const configCatalogStore = new ConfigCatalogStore(configAPI, () => configSnapshotStore);
