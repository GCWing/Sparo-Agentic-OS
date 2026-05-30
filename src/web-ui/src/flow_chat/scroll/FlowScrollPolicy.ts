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

export const FLOW_SCROLL_PROGRAMMATIC_GUARD_MS = 160;
export const FLOW_SCROLL_BOTTOM_THRESHOLD_PX = 100;
export const FLOW_SCROLL_NESTED_BOTTOM_THRESHOLD_PX = 80;
export const FLOW_SCROLL_VIRTUOSO_AUTO_FOLLOW_THRESHOLD_PX = 24;
export const FLOW_SCROLL_USER_DIRECTION_EPSILON_PX = 0.5;
export const FLOW_SCROLL_USER_INTENT_WINDOW_MS = 450;
export const FLOW_SCROLL_CONTINUOUS_FOLLOW_IDLE_FRAMES = 4;
