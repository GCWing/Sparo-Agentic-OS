# FlowChat Scroll Stability

How `VirtualMessageList` keeps the viewport stable while content heights
change. Read this before touching anything under
`src/web-ui/src/flow_chat/scroll/viewport/` or the footer rendering in
`VirtualMessageList.tsx`.

## Architecture In One Paragraph

A pure mode machine (`FlowViewportMachine`) decides what the viewport is doing
(`reading`, `pinned-latest`, `following`, `finalizing`, `navigating`). A
single rAF pipeline (`FlowViewportScheduler`) is the only writer of
`scrollTop`: each frame it reconciles the synthetic bottom reservation model
(`FlowViewportGeometry`), computes the mode's target position, and performs at
most one write. Input events dispatch machine events; observers only wake the
pipeline. There are no timing windows and no scroll-delta intent inference.

## The Reservation Model

The Virtuoso footer renders `inputStackFooterPx + collapsePx + pinPx` of
synthetic space:

- `collapsePx` — consumable shrink protection while reading.
- `pinPx` / `pinFloorPx` — the synthetic tail that makes "pin the latest user
  message to the 61px reading offset" reachable. Only space above the floor is
  consumable; the floor itself is exchanged against content growth.

Every growth/shrink comparison must use the effective height:

```ts
effectiveHeight = scrollHeight - (collapsePx + pinPx) - inputStackFooterPx
```

The unified bottom semantics is `getContentDistanceFromBottom` (excludes all
synthetic space). Virtuoso's `atBottomStateChange` is not used.

## The Equal-Exchange Invariant (pinned-latest)

While the latest turn is pinned, everything that changes height inside the
current turn happens **below** the pinned message. The pipeline re-measures
the pin floor from the live DOM every frame:

```
floor = max(0, desiredScrollTop - (scrollHeight - pinPx - clientHeight))
```

Content grows by Δ → floor shrinks by Δ → `scrollHeight` is constant →
`scrollTop` never moves. The user's message stays put while the answer fills
the blank. When the floor reaches zero mid-stream, the machine flips to
`following` — the two positions coincide exactly, so the handoff is seamless.

The floor **survives stream end**: short answers stay pinned with their blank.
It is released only by a new turn, an explicit navigation away, or a session
change. Pin mode is derived from the target (latest turn ⇒ `sticky-latest`,
older turn ⇒ `transient`), so anchor-dot jumps back to the latest turn rebuild
the blank instead of destroying it.

### Sticky floor ownership (layout contract)

The sticky floor is **not** a mode-scoped temporary buffer. It is a layout
contract owned by the latest turn's reading position:

- **Survives detours**: jumping to history or scrolling up only changes the
  viewport *mode* (`reading`); the floor stays in geometry untouched.
- **Frozen during detours**: downward-scroll consumption and height-delta
  reconciliation do not touch the floor while the user is away. Virtualization
  remeasurement while scrolling history is ignored.
- **Incremental missing-tail semantics**: `resolvePinMetrics` reports
  *additional* tail needed beyond the current `pinPx`. At equilibrium
  (message aligned, reservation correct) it is zero — meaning "keep the
  current floor", never "floor should be zero".
- **Restore trigger**: returning to the **content bottom** (not the physical
  bottom that includes the synthetic tail) re-enters `pinned-latest` when a
  live floor exists. `stepPinned` then re-aligns from measurement.
- **Equal exchange**: while `pinned-latest`, content growth shrinks the floor
  1:1 via `absorbPinnedContentGrowth`; measurement preserves equilibrium
  when `missingTailSpacePx` is zero.

## Height-Change Handling Matrix

| Mode | Growth (incl. animated expand) | Shrink (incl. animated collapse) |
|---|---|---|
| `pinned-latest` | floor absorbs it 1:1; zero movement | collapse intent bumps the floor synchronously (estimate), per-frame reconcile converges to measured; `scrollHeight` never dips, no clamp |
| `following` / `finalizing` | chase the tail every frame | no compensation; the viewport rides the tail upward |
| `reading` (near bottom) | consume consumable reservations | synchronous pre-compensation + anchor lock; no early consumption during CSS transitions |
| `reading` (change far above bottom) | nothing (scrollbar only) | nothing (fallback compensation is zero) |
| `navigating` | animator re-resolves its destination every frame | same |

`finalizing` is entered when the stream ends while following: the pipeline
keeps chasing the tail until layout is quiet (8 stable frames or 800ms), so
terminal auto-collapses and markdown upgrades are absorbed without a stall.
Consumable leftovers are cleared on settle; the sticky floor is not.

## Synchronous Writes (the only two exceptions)

`scrollTop` is written only inside the pipeline. Footer height has two
synchronous write paths that must land before the browser clamps or paints:

1. **Collapse-intent pre-compensation** (`flowchat:layout-collapse-intent`):
   in `reading`, add collapse compensation and arm the anchor lock; in
   `pinned-latest`, bump the pin floor. Both before the component shrinks.
2. **Downward-scroll consumption**: user scrolling down eats consumable
   reservation space inside the scroll event so the viewport can never enter
   visible synthetic blank.

`applyFooterNow` writes the style and forces layout reads
(`footer.offsetHeight`, `scroller.scrollHeight`) so the new height
participates in the same task. Do not move this to React state rendering.

## Why These Stay

- `overflow-anchor: none` on the scroller and footer
  (`VirtualMessageList.scss`): native browser anchoring fights the
  reservation model.
- Transition tracking (`grid-template-rows` / `height` / `max-height`):
  gates early consumption in `reading` and the settle detection in
  `finalizing`. Pinned/following do not depend on it — they measure the live
  DOM every frame and are immune to intermediate sizes.
- Measured-first reconciliation: concurrent expand + collapse in the same
  frame (new tool card appears while the explore group collapses) composes
  automatically because the floor is recomputed from rects, not from
  per-event bookkeeping.

## Common Ways To Break This

- Writing `scrollTop` anywhere outside the scheduler pipeline.
- Comparing raw `scrollHeight` deltas without subtracting reservations.
- Dispatching a collapse intent after `setState` instead of before it.
- Removing the pinned-mode synchronous floor bump (a 1-frame clamp flash
  returns: pinned scrollTop equals maxScrollTop, so any un-prefunded shrink
  clamps immediately).
- Clearing the pin floor on stream end (short answers will drop).
- Reintroducing time-window intent guards; upward input events must win
  unconditionally.
- Making the footer height React-state-driven per frame (one frame late =
  visible clamp).

## Verification Checklist

1. Send a message → the user message pins at the reading offset; no
   scroll-to-latest bar flash; the answer fills the blank without movement.
2. Dense token stream → wheel up once → the viewport is immediately yours; no
   pull-back.
3. Mid-turn explore-group auto-collapse while pinned → zero movement.
4. Simultaneous new-card expand + old-card collapse → no jitter.
5. Stream end with terminal auto-collapses → smooth settle, no leftover blank
   that needs a user scroll, no bar flash.
6. Short answer → stays pinned with blank after the turn ends; wheel-down
   cannot scroll into the blank.
7. Reading history near the bottom during a collapse → no drop-and-snap-back.
8. Anchor-dot jump to the latest turn → re-pins with blank intact; jump to an
   older turn → blank released, no clamp jump.
9. Session switch in both directions → no residual reservations.

Unit tests: `scroll/viewport/FlowViewportMachine.test.ts`,
`scroll/viewport/FlowViewportGeometry.test.ts`.
