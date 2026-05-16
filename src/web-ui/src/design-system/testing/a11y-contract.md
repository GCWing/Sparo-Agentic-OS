# Accessibility Contract

- Every interactive primitive must have a visible focus state.
- Icon-only controls must require or provide an accessible label.
- Dialogs must use dialog semantics, Escape handling, focus restore, and scroll locking.
- Custom selects, menus, and lists must support keyboard navigation.
- Preview coverage should include keyboard-focused examples for complex controls.
- Disabled controls must expose native disabled semantics or equivalent ARIA semantics and must not be reachable through accidental pointer-only affordances.
- Loading states must not trap focus or replace focused controls without an intentional focus restore path.
- Error states must connect the control and message with accessible relationships when the component owns validation UI.
- Long text and localized text must remain readable at narrow widths without overlapping adjacent controls.
- Theme variants must preserve contrast for text, focus rings, dividers, and status colors.
- Accessibility behavior owned by primitives must be implemented inside the design-system runtime layer, not by importing `app`, `shared`, `flow_chat`, `tools`, or `infrastructure`.
- Feature TS/TSX code should consume accessible primitives and patterns through `@/design-system`; direct alias imports from design-system internals and relative imports into design-system internals are gate violations outside the design-system package.
- Retired UI APIs are not accessibility fallbacks. Do not restore private reusable UI entrypoints to recover old behavior.
