# FlowChat Scroll Architecture

FlowChat scroll behavior is orchestrated from this module, not from individual
message, panel, or tool-card components.

## Layers

- `FlowScrollIntent.ts` detects user intent such as wheel-up, touch-up,
  keyboard-up, editable targets, and scrollbar gutter interactions.
- `FlowScrollPolicy.ts` defines shared modes, thresholds, and guard windows.
- `FlowScrollGeometry.ts` owns bottom reservations, anchor locks, collapse
  intents, and scroll-height sanitation for the virtualized main list.
- `FlowLayoutMutationEvents.ts` is the stable event contract for components
  that change layout height. Prefer `invalidateFlowLayout({ reason, priority })`
  over dispatching raw DOM events.
- `useFlowLayoutMutationContract.ts` is the preferred component-facing API for
  expand/collapse actions that affect FlowChat layout.
- `adapters/` binds the shared policy to concrete scroll hosts.

## Adapters

- `usePlainFlowScrollController` is for plain panel scroll containers such as
  task details and child sessions.
- `useNestedFlowScrollController` is for nested scroll regions inside cards,
  such as code previews, thinking output, and explore groups.
- `useVirtuosoFlowFollowOutput` is the Virtuoso-specific follow-output adapter.
- `useVirtuosoFlowGeometryController` owns bottom reservations, anchor locks,
  footer compensation, measured-height snapshots, and height-change scheduling
  for the virtualized list host.
- `useVirtuosoFlowLayoutMutationBridge` adapts layout mutation events into the
  main list's reservation and anchor-lock model.
- `useVirtuosoFlowLayoutObservers` owns ResizeObserver, MutationObserver, and
  transition listeners for the virtualized list host.
- `useVirtuosoFlowNavigationController` owns turn pinning, sticky pin
  reconciliation, pending pin retries, and imperative navigation commands for
  the virtualized list host.
- `useVirtuosoFlowUserIntentBridge` owns scroll, wheel, touch, keyboard, and
  scrollbar-drag intent handling for the virtualized list host.
- `useVirtuosoVisibleTurnTracker` owns DOM visibility measurement for the
  current turn marker in the virtualized list.

`VirtualMessageList` should only wire these adapters to the render tree and
expose controller commands through its imperative ref.

## Component Contract

Components should not directly preserve FlowChat scroll position. They should:

1. Use an adapter when they own a scroll container.
2. Use `useFlowLayoutMutationContract` before/after height-changing disclosure
   or predictable content upgrades.
3. Keep visual scroll-state decoration local, such as fade gradients.
4. Avoid direct `scrollTop = scrollHeight` follow logic.

The scroll layer decides whether the active user intent is following the latest
output, reading history, navigating, or stabilizing layout.
