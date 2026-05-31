export const FLOW_LAYOUT_MUTATION_EVENT = 'flowchat:layout-mutation';
export const FLOW_LAYOUT_COLLAPSE_INTENT_EVENT = 'flowchat:layout-collapse-intent';

export type FlowLayoutCollapseReason = 'manual' | 'auto';

export interface FlowLayoutCollapseIntentDetail {
  toolId?: string | null;
  toolName?: string | null;
  cardHeight?: number | null;
  filePath?: string | null;
  reason?: FlowLayoutCollapseReason | null;
  [key: string]: unknown;
}

export function dispatchFlowLayoutMutation(): void {
  window.dispatchEvent(new CustomEvent(FLOW_LAYOUT_MUTATION_EVENT));
}

export function dispatchFlowLayoutCollapseIntent(detail: FlowLayoutCollapseIntentDetail): void {
  window.dispatchEvent(new CustomEvent<FlowLayoutCollapseIntentDetail>(FLOW_LAYOUT_COLLAPSE_INTENT_EVENT, {
    detail,
  }));
}

export function isFlowLayoutCollapseIntentEvent(
  event: Event,
): event is CustomEvent<FlowLayoutCollapseIntentDetail> {
  return event.type === FLOW_LAYOUT_COLLAPSE_INTENT_EVENT;
}
