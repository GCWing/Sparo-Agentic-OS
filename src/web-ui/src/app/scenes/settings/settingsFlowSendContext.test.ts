import { describe, expect, it } from 'vitest';
import { createSettingsFlowSendContext } from './settingsFlowSendContext';

describe('createSettingsFlowSendContext', () => {
  it('attaches the authoritative revision and dirty manual drafts', () => {
    expect(createSettingsFlowSendContext(12, ['theme.mode', 'app.language'])).toEqual({
      metadata: {
        settingsContext: {
          expectedRevision: 12,
          dirtySettingIds: ['app.language', 'theme.mode'],
        },
      },
    });
  });
});
