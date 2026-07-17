/** A failed or cancelled turn is still conversation history worth resetting. */
export function shouldOfferSettingsSessionReset(turnCount: number): boolean {
  return Number.isFinite(turnCount) && turnCount > 0;
}
