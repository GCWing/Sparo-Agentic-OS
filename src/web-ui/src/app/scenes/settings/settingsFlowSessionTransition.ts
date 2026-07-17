import type { SettingsFlowSessionIdentity } from './settingsFlowSessionApi';

export class SettingsFlowSessionAdoptionError extends Error {
  constructor(
    readonly identity: SettingsFlowSessionIdentity,
    readonly originalError: unknown,
  ) {
    super('The new settings FlowChat session could not be attached locally');
    this.name = 'SettingsFlowSessionAdoptionError';
  }
}

/**
 * Adopt a backend-authoritative reset result before any fallible local work.
 * The old session no longer exists after reset succeeds, so attach failures
 * must never leave the UI pointing back at it.
 */
export async function adoptResetSettingsFlowSession({
  previousSessionId,
  identity,
  publishIdentity,
  detachPrevious,
  attachIdentity,
}: {
  previousSessionId: string;
  identity: SettingsFlowSessionIdentity;
  publishIdentity: (identity: SettingsFlowSessionIdentity) => void;
  detachPrevious: (sessionId: string) => void;
  attachIdentity: (identity: SettingsFlowSessionIdentity) => Promise<void>;
}): Promise<void> {
  publishIdentity(identity);

  try {
    detachPrevious(previousSessionId);
    await attachIdentity(identity);
  } catch (error) {
    throw new SettingsFlowSessionAdoptionError(identity, error);
  }
}
