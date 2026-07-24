// remotion-live :: backend.js (auto-split from ui.js; do not hand-merge)

import { state } from './state.js';
import { bridgeOutput, runtime, t } from './util.js';

const ACTION_TIMEOUT_MS = {
  detectProject: 30_000,
  getCompositionManifest: 90_000,
  compileProject: 300_000,
  ensurePlayerPreviewHost: 180_000,
  getPlayerPreviewHostStatus: 15_000,
  startExport: 90_000,
  getExportStatus: 15_000,
  cancelExport: 30_000,
};

async function callBackend(action, input = {}) {
  const host = runtime();
  if (!host.backend?.call) throw new Error(t('backendMissing'));
  const result = await host.backend.call(
    `remotionRuntime.${action}`,
    {
      workspacePath: state.workspacePath,
      ...input,
    },
    {
      entityId: state.workspacePath || 'default',
      idempotencyKey: `remotion-live-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
  );
  if (result?.bridgeResult) {
    const run = result.bridgeResult;
    if (run.status === 'failed' || run.status === 'cancelled') {
      throw new Error(run.error?.message || run.message || run.stderr || `${action} ${run.status}`);
    }
    return bridgeOutput(result);
  }
  if (!result?.actionRunId || !host.backend?.status) return bridgeOutput(result);

  const timeoutMs = ACTION_TIMEOUT_MS[action] || 60_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await host.backend.status(result.actionRunId, {
      sessionId: result.sessionId,
      turnId: result.turnId,
    });
    if (status?.status === 'completed') return bridgeOutput(status);
    if (status?.status === 'failed' || status?.status === 'cancelled') {
      throw new Error(status?.message || status?.stderr || status?.status);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await host.backend.cancelRun?.(result.actionRunId, {
    sessionId: result.sessionId,
    turnId: result.turnId,
  }).catch(() => null);
  throw new Error(`Backend action timed out: ${action}`);
}

export { callBackend };
