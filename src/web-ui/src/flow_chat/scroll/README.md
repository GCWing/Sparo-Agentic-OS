# FlowChat Scroll Architecture

FlowChat scroll behavior is orchestrated from this module, not from individual
message, panel, or tool-card components.

## Main List: Viewport Machine + Scheduler

The virtualized main chat list (`VirtualMessageList`) is driven by the
`viewport/` subsystem:

- `viewport/FlowViewportMachine.ts` — the pure mode state machine. The single
  authority for what the viewport is doing: `reading`, `pinned-latest`,
  `following`, `finalizing`, or `navigating`. All transitions are explicit
  events; nothing infers intent from scroll deltas or timing windows.
- `viewport/FlowViewportScheduler.ts` — the single requestAnimationFrame
  pipeline and the **only writer of `scrollTop`**. Each frame it reads
  geometry, reconciles reservations (growth consumption, pin floor, reading
  shrink protection), computes the mode's target position, and performs at
  most one scroll write. It also owns the retargeting ease-out animator used
  for smooth navigation (native `behavior: 'smooth'` cannot chase a growing
  bottom).
- `viewport/FlowViewportGeometry.ts` — pure math for the synthetic bottom
  reservation model (collapse compensation, pin tail + non-consumable floor,
  effective content height, the unified content-bottom distance).
- `viewport/useFlowViewportController.ts` — React assembly: input intent
  listeners, layout observers, layout mutation events, session/turn/stream
  effects, and the imperative command API consumed through
  `VirtualMessageListRef`.

### Core invariants

- `scrollTop` is written only by the scheduler pipeline (plus Virtuoso itself
  during `navigating` when the target item is not rendered yet — the one
  documented third-party writer).
- Footer height may additionally be written synchronously in two places that
  must land before the browser clamps or paints: collapse-intent
  pre-compensation and consumable-reservation consumption on user downward
  scroll. These never touch `scrollTop`.
- User intent is derived from input events (wheel up, touch pull-down, upward
  keys, scrollbar grab), never from scroll position deltas. An upward intent
  immediately dispatches `USER_SCROLL_UP` and hands the viewport to the user.
  There are no programmatic-scroll guard windows.
- While `pinned-latest`, content growth below the pinned turn is exchanged 1:1
  against the pin floor so `scrollHeight` stays constant and the pinned
  message never moves. The floor survives stream end (short answers stay
  pinned) and is only released by a new turn, an explicit navigation away, or
  a session change.
- Pin mode is derived from the target: pinning the latest turn is always
  `sticky-latest`; pinning an older turn is always `transient`.
- All height comparisons use effective heights
  (`scrollHeight - reservations - inputFooter`). The single "at bottom"
  semantics is `getContentDistanceFromBottom`, which excludes synthetic tail
  space; Virtuoso's `atBottomStateChange` is not used.

## Shared Layers

- `FlowScrollIntent.ts` classifies user input: wheel-up, touch-up,
  keyboard-up, editable targets, and scrollbar gutter interactions.
- `FlowScrollPolicy.ts` defines thresholds for the plain/nested panel
  controllers.
- `FlowLayoutMutationEvents.ts` is the stable event contract for components
  that change layout height. Prefer `invalidateFlowLayout({ reason, priority })`
  over dispatching raw DOM events.
- `useFlowLayoutMutationContract.ts` is the preferred component-facing API for
  expand/collapse actions that affect FlowChat layout.

## Panel Adapters

- `adapters/usePlainFlowScrollController` — plain panel scroll containers such
  as task details and child sessions.
- `adapters/useNestedFlowScrollController` — nested scroll regions inside
  cards, such as code previews, thinking output, and explore groups.
- `adapters/useTaskDetailPanelScrollController` — the task detail Virtuoso
  panel.
- `adapters/useVirtuosoVisibleTurnTracker` — DOM visibility measurement for
  the current turn marker in the virtualized list (measurement only; it never
  scrolls).

## Component Contract

Components must not preserve FlowChat scroll position themselves. They should:

1. Use an adapter when they own a scroll container.
2. Use `useFlowLayoutMutationContract` (or `useToolDisclosureController`)
   before/after height-changing disclosure or predictable content upgrades.
   Dispatch the collapse intent **before** the collapse state is applied, and
   prefer a generous `cardHeight` estimate (over-estimating is invisible;
   under-estimating flashes).
3. Keep visual scroll-state decoration local, such as fade gradients.
4. Never write `scrollTop = scrollHeight` follow logic against the main list.

The viewport machine decides whether the active mode is pinned, following,
finalizing, reading, or navigating — and how expand/collapse height changes
are absorbed in each. See `FLOWCHAT_SCROLL_STABILITY.md` next to
`VirtualMessageList.tsx` for the height-change handling matrix.
