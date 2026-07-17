# Floating Surfaces Recipe

Choose one of three design-system contracts for app-owned surfaces that appear above the current workspace.

## Lightweight floating card

Use `FloatingCard` for transient, non-modal content such as notifications, anchored helpers, and compact status cards.

- No overlay or focus trap.
- Large `2xl` corner radius and a clear two-stage floating shadow: a theme-owned near shadow establishes height while a wider ambient shadow separates the card from same-color content.
- No visually prominent border by default; the original elevated surface color is preserved, while a faint exterior perimeter edge and balanced outer shadow preserve separation on same-color backgrounds.
- Use the built-in `onDismiss` affordance instead of drawing a feature-local close button; its circular background appears only on hover or keyboard focus.
- Use `FloatingCardAction` for any additional icon-only commands so they keep the same circular filled treatment.
- Feature styles may control content layout and width, but must not redefine the surface background, border, radius, shadow, or entry motion.

```tsx
<FloatingCard
  padding="compact"
  onDismiss={dismiss}
  dismissLabel={t('actions.close')}
>
  <NotificationContent />
</FloatingCard>
```

## Popup menu

Use `DropdownMenu` for standard anchored command menus. It owns portal positioning, outside-click and Escape dismissal, viewport correction, simple menu rows, and nested submenus. The Agentic OS session header's More menu is the product baseline.

Use `PopupMenu` directly when a richer menu such as the Composer Add menu needs custom sections, moving row highlights, loading content, or a product-owned flyout. It provides the same surface contract without taking over product behavior.

- Intermediate `xl` corner radius: smaller than `FloatingCard` and larger than `AppWindow`.
- The same original elevated surface color, faint exterior perimeter edge, and two-stage floating shadow as `FloatingCard`, with no prominent border.
- Default compact padding for standard menus; use `padding="none"` only when the composed menu owns its internal section spacing.
- Feature styles may control anchoring, width, scrolling, and row layout, but must not redefine background, border, radius, shadow, or entry motion.

```tsx
<DropdownMenu open={open} anchorRef={anchorRef} items={items} onClose={close} />

<PopupMenu padding="none">
  <ComposerMenuSections />
</PopupMenu>
```

## Application window

Use `AppWindow` for an in-app popup window that carries substantial content, multiple sections, or a longer workflow.

- No backdrop, body scroll lock, or outside-click interception; the surrounding app remains visible and interactive.
- Smaller `lg` corner radius, original elevated surface color, elevated border, and a modal shadow with a narrow exterior top contact shadow. No inset shadow or surface tint is used.
- The built-in close command stays borderless and transparent until hover or keyboard focus reveals its circular background.
- Use `large`, `wide`, or `full` for standard content widths. `wide` is the Device Network baseline.
- Feature styles may control workflow-specific body layout or minimum height, but must not replace the dialog chrome or animation.

`AppWindow` receives focus when opened, supports Escape, and restores focus when closed, but it does not trap focus. Use `Dialog` only when a compact confirmation, short input flow, or focused decision must be modal.

`Dialog` shows header and footer dividers by default. Use `showDividers={false}` when a compact review surface needs one continuous reading flow and spacing already provides clear separation between its title, content, and actions.

Do not locally restyle `.ds-app-window` or `.ds-dialog` surface properties.
