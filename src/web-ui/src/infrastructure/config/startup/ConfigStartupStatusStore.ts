import { configAPI } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';
import type { ConfigStartupStatus, ConfigStartupStatusState } from './types';
import { isConfigReadOnlyRecovery } from './types';

const log = createLogger('ConfigStartupStatusStore');

const INITIAL_STATE: ConfigStartupStatusState = {
  loadState: 'idle',
  value: null,
  error: null,
};

export class ConfigReadOnlyRecoveryError extends Error {
  readonly code = 'config.recovery_read_only';

  constructor() {
    super('Configuration is read-only while Sparo OS is using recovery defaults');
    this.name = 'ConfigReadOnlyRecoveryError';
  }
}

export class ConfigStartupStatusStore {
  private state: ConfigStartupStatusState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private loadPromise: Promise<ConfigStartupStatus | null> | null = null;
  private rebuildPromise: Promise<ConfigStartupStatus> | null = null;

  getState = (): ConfigStartupStatusState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  load(): Promise<ConfigStartupStatus | null> {
    if (this.state.loadState === 'ready') {
      return Promise.resolve(this.state.value);
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.updateState({ loadState: 'loading', value: null, error: null });
    this.loadPromise = configAPI
      .getConfigStartupStatus()
      .then((value) => {
        this.updateState({ loadState: 'ready', value, error: null });
        if (isConfigReadOnlyRecovery(value)) {
          log.warn('Configuration started with read-only recovery defaults', {
            mode: value.mode,
            schemaVersion: value.schemaVersion,
            sourcePreserved: value.sourcePreserved,
            rebuildAllowed: value.rebuildAllowed,
            issueCode: value.issue?.code,
            issuePhase: value.issue?.phase,
          });
        }
        return value;
      })
      .catch((error: unknown) => {
        const resolvedError = error instanceof Error ? error : new Error(String(error));
        this.updateState({ loadState: 'error', value: null, error: resolvedError });
        log.error('Failed to load configuration startup status', { error: resolvedError });
        return null;
      })
      .finally(() => {
        this.loadPromise = null;
      });

    return this.loadPromise;
  }

  rebuildDefaults(): Promise<ConfigStartupStatus> {
    if (this.rebuildPromise) {
      return this.rebuildPromise;
    }
    this.rebuildPromise = configAPI
      .rebuildDefaultConfig()
      .then((value) => {
        this.updateState({ loadState: 'ready', value, error: null });
        log.info('Current default configuration rebuilt after user confirmation', {
          schemaVersion: value.schemaVersion,
        });
        return value;
      })
      .catch((error: unknown) => {
        const resolvedError = error instanceof Error ? error : new Error(String(error));
        log.error('Failed to rebuild default configuration', { error: resolvedError });
        throw resolvedError;
      })
      .finally(() => {
        this.rebuildPromise = null;
      });
    return this.rebuildPromise;
  }

  assertWritesAllowed(): void {
    if (isConfigReadOnlyRecovery(this.state.value)) {
      throw new ConfigReadOnlyRecoveryError();
    }
  }

  private updateState(nextState: ConfigStartupStatusState): void {
    this.state = nextState;
    this.listeners.forEach((listener) => listener());
  }
}

export const configStartupStatusStore = new ConfigStartupStatusStore();
