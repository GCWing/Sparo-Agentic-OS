import { configAPI } from '@/infrastructure/api';
import type {
  CommitConfigPatchRequest,
  ConfigApplyStatusEvent,
  ConfigCommit,
  ConfigCommittedEvent,
  ConfigPlan,
  ConfigRolledBackEvent,
  PlanConfigPatchRequest,
  RetryConfigApplyRequest,
  UndoConfigCommitRequest,
} from './types';
import { configStartupStatusStore } from '../startup/ConfigStartupStatusStore';

export interface ConfigTransactionTransport {
  planConfigPatch(request: PlanConfigPatchRequest): Promise<ConfigPlan>;
  commitConfigPatch(request: CommitConfigPatchRequest): Promise<ConfigCommit>;
  undoConfigCommit(request: UndoConfigCommitRequest): Promise<ConfigCommit>;
  getConfigCommit(commitId: string): Promise<ConfigCommit>;
  retryConfigApply(request: RetryConfigApplyRequest): Promise<ConfigCommit>;
  onConfigCommitted(callback: (event: ConfigCommittedEvent) => void): () => void;
  onConfigRolledBack(callback: (event: ConfigRolledBackEvent) => void): () => void;
  onConfigApplyStatus(callback: (event: ConfigApplyStatusEvent) => void): () => void;
}

export class ConfigConfirmationRequiredError extends Error {
  constructor(
    public readonly plan: ConfigPlan,
    public readonly commitRequest?: Omit<CommitConfigPatchRequest, 'planId' | 'confirmed'>,
  ) {
    super('Config plan requires confirmation');
    this.name = 'ConfigConfirmationRequiredError';
  }
}

/** The user deliberately kept the current value in a manual confirmation. */
export class ConfigConfirmationRejectedError extends Error {
  constructor() {
    super('Config change confirmation was rejected');
    this.name = 'ConfigConfirmationRejectedError';
  }
}

export class ConfigTransactionClient {
  constructor(private readonly transport: ConfigTransactionTransport) {}

  async plan(request: PlanConfigPatchRequest): Promise<ConfigPlan> {
    configStartupStatusStore.assertWritesAllowed();
    return this.transport.planConfigPatch(request);
  }

  async commit(request: CommitConfigPatchRequest): Promise<ConfigCommit> {
    configStartupStatusStore.assertWritesAllowed();
    return this.transport.commitConfigPatch(request);
  }

  async undo(request: UndoConfigCommitRequest): Promise<ConfigCommit> {
    configStartupStatusStore.assertWritesAllowed();
    return this.transport.undoConfigCommit(request);
  }

  getCommit(commitId: string): Promise<ConfigCommit> {
    return this.transport.getConfigCommit(commitId);
  }

  async retryApply(request: RetryConfigApplyRequest): Promise<ConfigCommit> {
    configStartupStatusStore.assertWritesAllowed();
    return this.transport.retryConfigApply(request);
  }

  onCommitted(callback: (event: ConfigCommittedEvent) => void): () => void {
    return this.transport.onConfigCommitted(callback);
  }

  onRolledBack(callback: (event: ConfigRolledBackEvent) => void): () => void {
    return this.transport.onConfigRolledBack(callback);
  }

  onApplyStatus(callback: (event: ConfigApplyStatusEvent) => void): () => void {
    return this.transport.onConfigApplyStatus(callback);
  }

  async apply(
    planRequest: PlanConfigPatchRequest,
    commitRequest: Omit<CommitConfigPatchRequest, 'planId' | 'confirmed'>,
  ): Promise<ConfigCommit> {
    const plan = await this.plan(planRequest);
    if (plan.requiresConfirmation) {
      throw new ConfigConfirmationRequiredError(plan, commitRequest);
    }
    return this.commit({ ...commitRequest, planId: plan.planId, confirmed: false });
  }
}

export const configTransactionClient = new ConfigTransactionClient(configAPI);

export function createConfigRequestId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomId}`;
}
