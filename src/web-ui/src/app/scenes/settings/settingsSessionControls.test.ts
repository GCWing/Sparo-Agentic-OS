import { describe, expect, it } from 'vitest';
import { shouldOfferSettingsSessionReset } from './settingsSessionControls';

describe('shouldOfferSettingsSessionReset', () => {
  it('hides reset for a completely blank app-lifetime conversation', () => {
    expect(shouldOfferSettingsSessionReset(0)).toBe(false);
  });

  it('offers reset as soon as any turn exists, including a failed turn', () => {
    expect(shouldOfferSettingsSessionReset(1)).toBe(true);
  });
});
