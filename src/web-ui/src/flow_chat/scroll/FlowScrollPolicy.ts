export type FlowScrollMode =
  | 'idle'
  | 'pinned-latest-turn'
  | 'following-output'
  | 'reading-history'
  | 'navigating-turn'
  | 'layout-stabilizing';

export type FlowScrollExitReason =
  | 'user-scroll-up'
  | 'keyboard-scroll-up'
  | 'touch-scroll-up'
  | 'scrollbar-drag'
  | 'explicit-navigation';

// Constants for plain/nested panel scroll controllers. The virtualized main
// list uses the viewport machine + scheduler under `viewport/` instead and
// does not rely on timing windows at all.
export const FLOW_SCROLL_PROGRAMMATIC_GUARD_MS = 160;
export const FLOW_SCROLL_BOTTOM_THRESHOLD_PX = 100;
export const FLOW_SCROLL_NESTED_BOTTOM_THRESHOLD_PX = 80;
