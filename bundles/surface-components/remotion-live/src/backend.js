// remotion-live :: backend.js (auto-split from ui.js; do not hand-merge)

import { state } from './state.js';
import { bridgeOutput, runtime, t } from './util.js';

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
  if (result?.bridgeResult) return bridgeOutput(result);
  if (!result?.actionRunId || !host.backend?.status) return bridgeOutput(result);

  const startedAt = Date.now();
  while (Date.now() - startedAt < 60000) {
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
  throw new Error(`Backend action timed out: ${action}`);
}


function entryInput() {
  return state.selectedEntry ? { entryPoint: state.selectedEntry } : {};
}


export { callBackend, entryInput };
