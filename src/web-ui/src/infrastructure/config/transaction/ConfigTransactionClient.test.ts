import { describe, expect, it, vi } from 'vitest';
import {
  ConfigConfirmationRequiredError,
  ConfigTransactionClient,
  type ConfigTransactionTransport,
} from './ConfigTransactionClient';
import type {
  ConfigCommit,
  ConfigPlan,
  PlanConfigPatchRequest,
} from './types';

const PLAN_REQUEST: PlanConfigPatchRequest = {
  requestId: 'request-1',
  idempotencyKey: 'change-1',
  expectedRevision: 4,
  scope: { kind: 'user' },
  operations: [{ op: 'set', settingId: 'core.test.value', value: true }],
};

function createPlan(requiresConfirmation: boolean): ConfigPlan {
  return {
    planId: 'plan-1',
    baseRevision: 4,
    catalogVersion: 'catalog-v1',
    operationHash: 'operation-hash-1',
    expiresAtMs: Date.now() + 60_000,
    changes: [],
    requiresConfirmation,
    affectedSections: [],
    warnings: [],
  };
}

function createCommit(): ConfigCommit {
  return {
    commitId: 'commit-1',
    revision: 5,
    status: 'applied',
    scope: { kind: 'user' },
    source: { kind: 'manual', surface: 'test' },
    changes: [],
    applyReceipts: [{
      consumer: 'runtime-logging',
      settingIds: ['logging.level'],
      attempt: 1,
      attemptedAt: '2026-07-13T00:00:01Z',
      status: 'applied',
      critical: false,
    }],
    affectedSections: [],
    restartRequired: [],
    undoToken: 'undo-token-1',
    committedAt: '2026-07-13T00:00:00Z',
  };
}

function createHarness(plan: ConfigPlan) {
  const commit = createCommit();
  const transport: ConfigTransactionTransport = {
    planConfigPatch: vi.fn(async () => plan),
    commitConfigPatch: vi.fn(async () => commit),
    undoConfigCommit: vi.fn(async () => commit),
    getConfigCommit: vi.fn(async () => commit),
    retryConfigApply: vi.fn(async () => commit),
    onConfigCommitted: vi.fn(() => () => undefined),
    onConfigRolledBack: vi.fn(() => () => undefined),
    onConfigApplyStatus: vi.fn(() => () => undefined),
  };
  return { client: new ConfigTransactionClient(transport), transport, commit };
}

describe('ConfigTransactionClient', () => {
  it('auto-commits a safe plan with an explicit unconfirmed backend request', async () => {
    const harness = createHarness(createPlan(false));

    await expect(harness.client.apply(PLAN_REQUEST, {
      expectedRevision: 4,
      idempotencyKey: 'change-1',
    })).resolves.toEqual(harness.commit);

    expect(harness.transport.commitConfigPatch).toHaveBeenCalledWith({
      planId: 'plan-1',
      expectedRevision: 4,
      idempotencyKey: 'change-1',
      confirmed: false,
    });
  });

  it('returns the reviewed plan instead of auto-committing when confirmation is required', async () => {
    const harness = createHarness(createPlan(true));

    await expect(harness.client.apply(PLAN_REQUEST, {
      expectedRevision: 4,
      idempotencyKey: 'change-1',
    })).rejects.toBeInstanceOf(ConfigConfirmationRequiredError);
    expect(harness.transport.commitConfigPatch).not.toHaveBeenCalled();
  });

  it('passes authoritative commit, retry, confirmation, and revision data to the transport', async () => {
    const harness = createHarness(createPlan(true));
    const commitRequest = {
      planId: 'plan-1',
      expectedRevision: 4,
      idempotencyKey: 'confirmed-change-1',
      confirmed: true,
    } as const;
    const undoRequest = {
      commitId: 'commit-1',
      undoToken: 'undo-token-1',
      expectedRevision: 5,
      idempotencyKey: 'undo-1',
      confirmed: true,
    } as const;
    const retryRequest = {
      commitId: 'commit-1',
      expectedRevision: 5,
      consumer: 'runtime-logging',
      expectedAttempt: 1,
      idempotencyKey: 'retry-1',
    } as const;

    await harness.client.commit(commitRequest);
    await harness.client.undo(undoRequest);
    await harness.client.getCommit('commit-1');
    await harness.client.retryApply(retryRequest);

    expect(harness.transport.commitConfigPatch).toHaveBeenCalledWith(commitRequest);
    expect(harness.transport.undoConfigCommit).toHaveBeenCalledWith(undoRequest);
    expect(harness.transport.getConfigCommit).toHaveBeenCalledWith('commit-1');
    expect(harness.transport.retryConfigApply).toHaveBeenCalledWith(retryRequest);
  });

  it('owns transaction event subscriptions instead of exposing the transport', () => {
    const harness = createHarness(createPlan(false));
    const onCommitted = vi.fn();
    const onRolledBack = vi.fn();
    const onApplyStatus = vi.fn();

    const stopCommitted = harness.client.onCommitted(onCommitted);
    const stopRolledBack = harness.client.onRolledBack(onRolledBack);
    const stopApplyStatus = harness.client.onApplyStatus(onApplyStatus);

    expect(harness.transport.onConfigCommitted).toHaveBeenCalledWith(onCommitted);
    expect(harness.transport.onConfigRolledBack).toHaveBeenCalledWith(onRolledBack);
    expect(harness.transport.onConfigApplyStatus).toHaveBeenCalledWith(onApplyStatus);
    expect(stopCommitted).toBeTypeOf('function');
    expect(stopRolledBack).toBeTypeOf('function');
    expect(stopApplyStatus).toBeTypeOf('function');
  });
});
