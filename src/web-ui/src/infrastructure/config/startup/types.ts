export type ConfigStartupMode = 'persistent' | 'readOnlyDefaults';

export type ConfigStartupFailurePhase = 'load' | 'validation' | 'journal';

export interface ConfigStartupIssue {
  code: string;
  phase: ConfigStartupFailurePhase;
}

/**
 * Redacted runtime status published by the authoritative configuration
 * service. It intentionally contains no local paths or raw startup errors.
 */
export interface ConfigStartupStatus {
  mode: ConfigStartupMode;
  schemaVersion: string;
  writesAllowed: boolean;
  sourcePreserved: boolean;
  rebuildAllowed: boolean;
  issue?: ConfigStartupIssue | null;
}

export interface ConfigStartupStatusState {
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  value: ConfigStartupStatus | null;
  error: Error | null;
}

export function isConfigReadOnlyRecovery(
  status: ConfigStartupStatus | null | undefined,
): boolean {
  return status?.mode === 'readOnlyDefaults' || status?.writesAllowed === false;
}
