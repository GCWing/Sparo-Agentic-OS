# Tool Card Conventions

This document captures UI behavior conventions for Flow Chat tool cards.

## Compact Row Inline Actions

Compact cards such as `ReadFileDisplay`, `LSDisplay`, and collapsed shell-style
rows should keep the row visually text-first:

- Put the primary summary in the compact `content` slot.
- Avoid using the `action` slot when the label should match normal summary
  text; `action` is intentionally a stronger label.
- Place small contextual action icons immediately after the relevant content,
  not in a persistent right rail. These icons represent domain actions such as
  opening the file or terminal panel; the row click itself can still own
  expand/collapse.
- Use a real `button` for independent actions; use an `aria-hidden` span only
  when the whole row already owns the click.
- Hide contextual icon buttons by default and reveal them on row hover/focus with
  `.compact-inline-action-button`.
- Keep `rightIcon` for always-visible state/metadata only. Do not use it for
  routine expand/open affordances in compact rows.

Preferred pattern:

```tsx
<ToolCompactHeaderLayout
  status={status}
  content={(
    <>
      {t('toolCards.example.action')}: <span className="example-target">{label}</span>
      {hasInlineMeta && <span className="example-meta">+3 -1</span>}
      {canOpenTarget && (
        <button
          type="button"
          className="compact-inline-action-button"
          onClick={openTarget}
          aria-label={t('toolCards.example.openTarget')}
        >
          <ExternalLink size={12} />
        </button>
      )}
    </>
  )}
/>
```

Current examples:

- `FileOperationToolCard`
- `TerminalToolCard` collapsed shell row

## Preview-to-Result Transition

For tool cards that:

- render a preview while content or params are still arriving
- render a different result view after completion
- can affect list height near the bottom of the conversation

keep the preview visible until the centralized tool view state reaches the result
phase.

Do not gate the preview only on an input-streaming phase.
There is often a short intermediate window where streaming has ended but the tool
is still not completed. If the preview disappears during that window, the card
can temporarily collapse to header-only height and cause visible vertical drift
in `VirtualMessageList`.

Preferred pattern:

```tsx
const viewState = getToolViewState(toolItem);
const runtimeState = deriveToolRuntimeState(toolItem);

if (viewState.phase !== 'result' && previewContent) {
  return <PreviewComponent content={previewContent} />;
}

if (viewState.phase === 'result' && finalContent) {
  return <ResultComponent content={finalContent} />;
}
```

Current examples:

- `FileOperationToolCard` `Write`
- `FileOperationToolCard` `Edit`

## Auto-Scroll Behavior For Previews

When the preview uses a scrolling code viewer, only auto-scroll while content is
actively streaming. Do not keep forcing auto-scroll after streaming has stopped.

Preferred pattern:

```tsx
<CodePreview
  content={previewContent}
  isStreaming={runtimeState.inputPhase === 'streaming'}
  autoScrollToBottom={runtimeState.inputPhase === 'streaming'}
/>
```

## Known Height Changes

If a tool card performs a user-triggered or predictable collapse that can reduce
its height near the bottom of the conversation, dispatch
`flowchat:layout-collapse-intent` before the collapse happens so
`VirtualMessageList` can pre-compensate.

This applies to both:

- manual expand/collapse actions
- automatic status-driven collapses such as collapsing when a tool completes

After a height-changing expand/collapse actually happens, also dispatch
`flowchat:layout-mutation` so `VirtualMessageList` can schedule follow-up measurement
and reconcile the final layout.

Tool cards should treat the list's bottom-spacing logic as an internal
implementation detail. Do not couple card behavior to specific reservation or
compensation fields inside `VirtualMessageList`; the stable contract for cards is
still the event pair above plus `useFlowLayoutMutationContract`.

Preferred pattern:

```tsx
const cardHeight = cardRootRef.current?.getBoundingClientRect().height ?? null;

if (willCollapse) {
  window.dispatchEvent(new CustomEvent('flowchat:layout-collapse-intent', {
    detail: {
      toolId,
      toolName,
      cardHeight,
      reason: 'manual', // or 'auto'
    }
  }));
}

setIsExpanded(nextExpanded);
window.dispatchEvent(new CustomEvent('flowchat:layout-mutation'));
```

Preferred implementation:

Use `useFlowLayoutMutationContract` unless the component truly needs a custom
special-case implementation.

```tsx
const { cardRootRef, applyExpandedState } = useFlowLayoutMutationContract({
  toolId,
  toolName,
});

applyExpandedState(isExpanded, nextExpanded, setIsExpanded, {
  reason: 'manual', // or 'auto'
  detail: {
    filePath,
  },
});
```

If the collapsing region's effective height is better estimated by an inner
scroll container than the outer wrapper, pass `getCardHeight` to the helper.
Current examples include `ModelThinkingDisplay` and `ExploreGroupRenderer`.

Current examples:

- `useFlowLayoutMutationContract`
- `FileOperationToolCard`
- `ModelThinkingDisplay`
- `TerminalToolCard`
- `ExploreGroupRenderer`

For details, read:

- `src/web-ui/src/flow_chat/components/modern/FLOWCHAT_SCROLL_STABILITY.md`
