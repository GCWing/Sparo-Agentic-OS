import { describe, expect, it } from 'vitest';
import {
  resolveSettingsFlowSendErrorKind,
  settingsFlowSendErrorMessageKey,
} from './settingsFlowSendError';

describe('settings FlowChat send error presentation', () => {
  it.each([
    ['settings.secure_input_required', 'secureInputRequired'],
    ['settings.request_invalid', 'requestInvalid'],
    ['config.revision_conflict', 'revisionConflict'],
    ['config.manual_draft_conflict', 'manualDraftConflict'],
    ['config.recovery_read_only', 'recoveryReadOnly'],
  ] as const)('maps %s to a localizable settings error', (code, kind) => {
    expect(resolveSettingsFlowSendErrorKind(new Error(code))).toBe(kind);
  });

  it('reads a stable code from command-error objects', () => {
    expect(resolveSettingsFlowSendErrorKind({
      code: 'config.revision_conflict',
    })).toBe('revisionConflict');
  });

  it('uses a generic localized fallback without exposing unknown backend details', () => {
    expect(settingsFlowSendErrorMessageKey(
      new Error('provider failure at C:/private/path token=secret'),
    )).toBe('settings/ai-mode:session.sendErrors.fallback');
  });
});
