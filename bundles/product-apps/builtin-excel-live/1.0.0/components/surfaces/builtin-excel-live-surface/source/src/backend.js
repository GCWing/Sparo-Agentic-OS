import { state } from './state.js';
import { bridgeOutput, runtime, uid } from './util.js';
import { t } from './i18n.js';

async function callExcel(action, input = {}) {
  const host = runtime();
  if (!host.backend?.call) throw new Error(t('backendMissing'));

  const workspacePath = input.workspacePath || state.workspacePath;
  if (!workspacePath) throw new Error(t('noWorkspace'));

  const payload = {
    workspacePath,
    ...input,
  };
  if (!payload.workbookId && state.workbookId) {
    payload.workbookId = state.workbookId;
  }

  const result = await host.backend.call(
    `excelEngine.${action}`,
    payload,
    {
      entityId: payload.workbookId || workspacePath || 'default',
      idempotencyKey: `excel-live-${action}-${uid('idem')}`,
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
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Backend action timed out: ${action}`);
}

export { callExcel };
