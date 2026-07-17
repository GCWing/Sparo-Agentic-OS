import { describe, expect, it, vi } from 'vitest';
import {
  cancelFlowChatTask,
  getStopGenerationShortcutId,
} from './flowChatContainerActions';

describe('getStopGenerationShortcutId', () => {
  it('keeps embedded instances independent from the default chat registration', () => {
    const ids = new Set([
      getStopGenerationShortcutId('default', 'primary-session'),
      getStopGenerationShortcutId('embedded', 'settings-session'),
      getStopGenerationShortcutId('embedded', 'another-settings-session'),
    ]);

    expect(ids).toEqual(new Set([
      'chat.stopGeneration',
      'chat.stopGeneration.embedded.settings-session',
      'chat.stopGeneration.embedded.another-settings-session',
    ]));
  });
});

describe('cancelFlowChatTask', () => {
  it('targets the explicitly embedded session instead of global focus', async () => {
    const manager = {
      cancelCurrentTask: vi.fn(async () => true),
      cancelTaskForSession: vi.fn(async () => true),
    };

    await cancelFlowChatTask(manager, 'settings-session');

    expect(manager.cancelTaskForSession).toHaveBeenCalledWith('settings-session');
    expect(manager.cancelCurrentTask).not.toHaveBeenCalled();
  });

  it('uses global focus only when no explicit session exists', async () => {
    const manager = {
      cancelCurrentTask: vi.fn(async () => true),
      cancelTaskForSession: vi.fn(async () => true),
    };

    await cancelFlowChatTask(manager);

    expect(manager.cancelCurrentTask).toHaveBeenCalledOnce();
    expect(manager.cancelTaskForSession).not.toHaveBeenCalled();
  });
});
