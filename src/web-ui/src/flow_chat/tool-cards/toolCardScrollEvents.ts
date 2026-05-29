export const TOOL_CARD_TOGGLE_EVENT = 'tool-card-toggle';
export const TOOL_CARD_COLLAPSE_INTENT_EVENT = 'flowchat:tool-card-collapse-intent';

export type ToolCardCollapseReason = 'manual' | 'auto';

export interface ToolCardCollapseIntentDetail {
  toolId?: string | null;
  toolName?: string | null;
  cardHeight?: number | null;
  filePath?: string | null;
  reason?: ToolCardCollapseReason | null;
  [key: string]: unknown;
}

export function dispatchToolCardToggle(): void {
  window.dispatchEvent(new CustomEvent(TOOL_CARD_TOGGLE_EVENT));
}

export function dispatchToolCardCollapseIntent(detail: ToolCardCollapseIntentDetail): void {
  window.dispatchEvent(new CustomEvent<ToolCardCollapseIntentDetail>(TOOL_CARD_COLLAPSE_INTENT_EVENT, {
    detail,
  }));
}

export function isToolCardCollapseIntentEvent(
  event: Event,
): event is CustomEvent<ToolCardCollapseIntentDetail> {
  return event.type === TOOL_CARD_COLLAPSE_INTENT_EVENT;
}
