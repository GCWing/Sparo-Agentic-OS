export const FLOW_LAYOUT_MUTATION_EVENT = 'flowchat:layout-mutation';
export const FLOW_LAYOUT_COLLAPSE_INTENT_EVENT = 'flowchat:layout-collapse-intent';

export type FlowLayoutCollapseReason = 'manual' | 'auto';
export type FlowLayoutInvalidationPriority = 'normal' | 'high';

export interface FlowLayoutMutationDetail {
  reason?: string | null;
  priority?: FlowLayoutInvalidationPriority;
  source?: string | null;
  [key: string]: unknown;
}

export interface FlowLayoutCollapseIntentDetail {
  toolId?: string | null;
  toolName?: string | null;
  cardHeight?: number | null;
  filePath?: string | null;
  reason?: FlowLayoutCollapseReason | null;
  [key: string]: unknown;
}

export function invalidateFlowLayout(detail: FlowLayoutMutationDetail = {}): void {
  window.dispatchEvent(new CustomEvent<FlowLayoutMutationDetail>(FLOW_LAYOUT_MUTATION_EVENT, {
    detail: {
      priority: 'normal',
      ...detail,
    },
  }));
}

export function dispatchFlowLayoutMutation(): void {
  invalidateFlowLayout();
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

export function isFlowLayoutMutationEvent(
  event: Event,
): event is CustomEvent<FlowLayoutMutationDetail> {
  return event.type === FLOW_LAYOUT_MUTATION_EVENT;
}
