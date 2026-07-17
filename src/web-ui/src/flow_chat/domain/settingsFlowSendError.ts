export type SettingsFlowSendErrorKind =
  | 'secureInputRequired'
  | 'requestInvalid'
  | 'revisionConflict'
  | 'manualDraftConflict'
  | 'recoveryReadOnly'
  | 'fallback';

const ERROR_KIND_BY_CODE = {
  'settings.secure_input_required': 'secureInputRequired',
  'settings.request_invalid': 'requestInvalid',
  'config.revision_conflict': 'revisionConflict',
  'config.manual_draft_conflict': 'manualDraftConflict',
  'config.recovery_read_only': 'recoveryReadOnly',
} as const satisfies Record<string, Exclude<SettingsFlowSendErrorKind, 'fallback'>>;

function searchableErrorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const originalError = (error as Error & {
      context?: { originalError?: unknown };
    }).context?.originalError;
    return `${error.message} ${searchableErrorText(originalError)}`;
  }
  if (error && typeof error === 'object') {
    const candidate = error as { code?: unknown; message?: unknown };
    return [candidate.code, candidate.message]
      .filter((value): value is string => typeof value === 'string')
      .join(' ');
  }
  return '';
}

export function resolveSettingsFlowSendErrorKind(error: unknown): SettingsFlowSendErrorKind {
  const text = searchableErrorText(error);
  const matched = Object.entries(ERROR_KIND_BY_CODE)
    .find(([code]) => text.includes(code));
  return matched?.[1] ?? 'fallback';
}

export function settingsFlowSendErrorMessageKey(error: unknown): string {
  return `settings/ai-mode:session.sendErrors.${resolveSettingsFlowSendErrorKind(error)}`;
}
