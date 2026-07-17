import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  confirmToolExecution: vi.fn(),
}));

vi.mock('@/infrastructure/api/service-api/ToolAPI', () => ({
  toolAPI: {
    confirmToolExecution: mocks.confirmToolExecution,
  },
}));

import { agentService } from './agent-service';

describe('AgentService.confirmToolExecution', () => {
  beforeEach(() => {
    mocks.confirmToolExecution.mockReset();
    mocks.confirmToolExecution.mockResolvedValue(undefined);
  });

  it('omits updatedInput when confirmation accepts the original tool input', async () => {
    await agentService.confirmToolExecution('settings-session', 'settings-tool', 'confirm');

    expect(mocks.confirmToolExecution).toHaveBeenCalledWith({
      sessionId: 'settings-session',
      toolId: 'settings-tool',
      action: 'confirm',
    });
  });

  it('forwards updatedInput only when the caller explicitly edits it', async () => {
    const updatedInput = { changes: [{ settingId: 'appearance.fontSize', value: 18 }] };

    await agentService.confirmToolExecution(
      'regular-session',
      'editable-tool',
      'confirm',
      updatedInput,
    );

    expect(mocks.confirmToolExecution).toHaveBeenCalledWith({
      sessionId: 'regular-session',
      toolId: 'editable-tool',
      action: 'confirm',
      updatedInput,
    });
  });
});
