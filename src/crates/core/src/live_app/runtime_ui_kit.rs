//! Live App Runtime UI Kit.
//!
//! This is a small, stable runtime subset of the Web UI component library for
//! sandboxed Live Apps. It intentionally uses plain DOM helpers plus CSS class
//! contracts that mirror the component-library primitives, so Live Apps can use
//! consistent UI without importing development-time React/Vite modules.

/// Names exported by `window.app.ui`.
pub const RUNTIME_UI_KIT_COMPONENTS: &[&str] = &[
    "Button",
    "Card",
    "CardHeader",
    "CardBody",
    "CardFooter",
    "Input",
    "Badge",
    "Alert",
    "Empty",
    "Stack",
    "Toolbar",
];

/// CSS for the runtime UI kit. The class names intentionally mirror a small
/// whitelist of component-library class contracts (`btn`, `v-card`,
/// `sparo-input-wrapper`, `badge`, `alert`) while resolving all visual tokens
/// through Live App host theme variables.
pub fn build_runtime_ui_kit_css() -> &'static str {
    r#"<style id="sparo-runtime-ui-kit">
:root {
  --color-bg-primary: var(--sparo-app-bg, var(--sparo-bg, #121214));
  --color-bg-secondary: var(--sparo-app-surface, var(--sparo-bg-secondary, #18181a));
  --color-bg-elevated: var(--sparo-app-panel, var(--sparo-bg-elevated, #1f1f23));
  --color-text-primary: var(--sparo-app-text, var(--sparo-text, #e8e8e8));
  --color-text-secondary: var(--sparo-app-text-secondary, var(--sparo-text-secondary, #b0b0b0));
  --color-text-muted: var(--sparo-app-text-muted, var(--sparo-text-muted, #858585));
  --color-accent-500: var(--sparo-app-accent, var(--sparo-accent, #60a5fa));
  --color-accent-hover: var(--sparo-app-accent-hover, var(--sparo-accent-hover, #3b82f6));
  --color-success: var(--sparo-success, #34d399);
  --color-warning: var(--sparo-warning, #f59e0b);
  --color-error: var(--sparo-error, #ef4444);
  --color-info: var(--sparo-info, #E1AB80);
  --border-base: var(--sparo-app-border, var(--sparo-border, rgba(255, 255, 255, 0.14)));
  --border-subtle: var(--sparo-app-border-subtle, var(--sparo-border-subtle, rgba(255, 255, 255, 0.08)));
  --border-strong: color-mix(in srgb, var(--sparo-border, #2e2e32) 78%, var(--sparo-text, #fff));
  --element-bg-base: var(--sparo-app-control-bg, var(--sparo-element-bg, rgba(255, 255, 255, 0.08)));
  --element-bg-medium: var(--sparo-app-control-hover, var(--sparo-element-hover, rgba(255, 255, 255, 0.14)));
  --element-bg-soft: color-mix(in srgb, var(--sparo-element-bg, #27272a) 72%, transparent);
  --card-bg-default: var(--sparo-app-card, var(--sparo-bg-elevated, rgba(255, 255, 255, 0.04)));
  --card-bg-elevated: var(--sparo-app-panel, color-mix(in srgb, var(--sparo-bg-elevated, #18181a) 90%, var(--sparo-text, #fff)));
  --card-bg-subtle: var(--sparo-app-surface, var(--sparo-bg-secondary, rgba(255, 255, 255, 0.02)));
  --size-radius-sm: var(--sparo-app-radius-sm, var(--sparo-radius, 6px));
  --size-radius-base: var(--sparo-app-radius, var(--sparo-radius-lg, 10px));
  --size-radius-lg: var(--sparo-app-radius-lg, calc(var(--sparo-radius-lg, 10px) + 2px));
  --size-gap-1: 4px;
  --size-gap-2: 8px;
  --size-gap-3: 12px;
  --size-gap-4: 16px;
  --size-gap-6: 24px;
  --font-family-sans: var(--sparo-font-sans, system-ui, sans-serif);
  --font-size-xs: 12px;
  --font-size-sm: 14px;
  --font-size-base: 15px;
  --font-size-lg: 16px;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --line-height-tight: 1.2;
  --line-height-base: 1.5;
  --line-height-relaxed: 1.6;
  --motion-fast: 0.15s;
  --motion-base: 0.24s;
  --easing-standard: cubic-bezier(0.4, 0, 0.2, 1);
}

.bfui-stack {
  display: flex;
  flex-direction: column;
  gap: var(--bfui-gap, var(--size-gap-3));
}

.bfui-stack--row {
  flex-direction: row;
  align-items: center;
}

.bfui-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-gap-3);
  min-height: 36px;
}

.bfui-toolbar__group {
  display: flex;
  align-items: center;
  gap: var(--size-gap-2);
  min-width: 0;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--size-gap-2);
  min-height: 32px;
  border: 0;
  border-radius: var(--size-radius-sm);
  font-family: var(--font-family-sans);
  font-weight: var(--font-weight-medium);
  text-decoration: none;
  user-select: none;
  cursor: pointer;
  outline: none;
  transition: background var(--motion-fast) var(--easing-standard), color var(--motion-fast) var(--easing-standard), border-color var(--motion-fast) var(--easing-standard), opacity var(--motion-fast) var(--easing-standard);
}

.btn:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--color-accent-500) 55%, transparent);
  outline-offset: 1px;
}

.btn-sm {
  height: 32px;
  padding: 0 var(--size-gap-3);
  font-size: var(--font-size-sm);
}

.btn-base {
  height: 40px;
  padding: 0 var(--size-gap-4);
  font-size: var(--font-size-base);
}

.btn-lg {
  height: 48px;
  padding: 0 var(--size-gap-6);
  font-size: var(--font-size-lg);
}

.btn-primary {
  background: var(--color-accent-500);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-secondary {
  background: var(--element-bg-base);
  color: var(--color-text-secondary);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--element-bg-medium);
  color: var(--color-text-primary);
}

.btn-ghost {
  background: transparent;
  color: var(--color-text-secondary);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--element-bg-soft);
  color: var(--color-text-primary);
}

.btn-dashed {
  background: transparent;
  color: var(--color-text-secondary);
  border: 1px dashed var(--border-base);
}

.btn-dashed:hover:not(:disabled) {
  background: var(--element-bg-soft);
  border-style: solid;
}

.btn-action-danger {
  background: color-mix(in srgb, var(--color-error) 18%, transparent);
  color: var(--color-error);
}

.btn-action-success {
  background: color-mix(in srgb, var(--color-success) 18%, transparent);
  color: var(--color-success);
}

.btn-icon-only {
  width: 40px;
  padding: 0;
  aspect-ratio: 1;
}

.btn-sm.btn-icon-only {
  width: 32px;
}

.btn-lg.btn-icon-only {
  width: 48px;
}

.btn:disabled,
.btn-disabled {
  opacity: 0.45;
  cursor: default;
  pointer-events: none;
}

.btn-loading-icon {
  width: 16px;
  height: 16px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: bfui-spin 1s linear infinite;
}

@keyframes bfui-spin {
  to { transform: rotate(360deg); }
}

.v-card {
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--card-bg-default);
  border: 1px solid var(--border-subtle);
  border-radius: var(--size-radius-base);
  color: var(--color-text-secondary);
  transition: background var(--motion-base) var(--easing-standard), border-color var(--motion-base) var(--easing-standard);
}

.v-card--elevated {
  background: var(--card-bg-elevated);
  border-color: var(--border-base);
}

.v-card--subtle {
  background: var(--card-bg-subtle);
}

.v-card--accent {
  background: color-mix(in srgb, var(--color-accent-500) 10%, transparent);
  border-color: color-mix(in srgb, var(--color-accent-500) 28%, transparent);
}

.v-card--interactive {
  cursor: pointer;
}

.v-card--interactive:hover {
  background: color-mix(in srgb, var(--card-bg-default) 86%, var(--color-text-primary));
}

.v-card--padding-none { padding: 0; }
.v-card--padding-small { padding: var(--size-gap-2); }
.v-card--padding-medium { padding: var(--size-gap-4); }
.v-card--padding-large { padding: var(--size-gap-6); }
.v-card--radius-small { border-radius: var(--size-radius-sm); }
.v-card--radius-medium { border-radius: var(--size-radius-base); }
.v-card--radius-large { border-radius: var(--size-radius-lg); }
.v-card--full-width { width: 100%; }

.v-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--size-gap-3);
}

.v-card-header__content {
  flex: 1;
  min-width: 0;
}

.v-card-header__title {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  line-height: var(--line-height-tight);
}

.v-card-header__subtitle {
  margin-top: var(--size-gap-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);
}

.v-card-header__extra,
.v-card-footer {
  display: flex;
  align-items: center;
  gap: var(--size-gap-2);
}

.v-card-body {
  flex: 1;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-relaxed);
}

.v-card-header + .v-card-body {
  margin-top: var(--size-gap-3);
  padding-top: var(--size-gap-3);
  border-top: 1px dashed var(--border-subtle);
}

.v-card-body + .v-card-footer,
.v-card-header + .v-card-footer {
  margin-top: var(--size-gap-4);
}

.v-card-footer--left { justify-content: flex-start; }
.v-card-footer--center { justify-content: center; }
.v-card-footer--right { justify-content: flex-end; }
.v-card-footer--between { justify-content: space-between; }

.sparo-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.sparo-input-label {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.sparo-input-container {
  display: flex;
  align-items: center;
  gap: var(--size-gap-2);
  min-width: 0;
  height: 36px;
  padding: 0 var(--size-gap-3);
  border: 1px solid var(--border-base);
  border-radius: var(--size-radius-sm);
  background: transparent;
  transition: background var(--motion-base) var(--easing-standard), border-color var(--motion-base) var(--easing-standard);
}

.sparo-input-wrapper--small .sparo-input-container { height: 32px; font-size: 13px; }
.sparo-input-wrapper--medium .sparo-input-container { height: 36px; font-size: 14px; }
.sparo-input-wrapper--large .sparo-input-container { height: 44px; font-size: 15px; }
.sparo-input-wrapper--filled .sparo-input-container { background: var(--element-bg-soft); border-color: transparent; }
.sparo-input-wrapper--outlined .sparo-input-container { border-color: var(--border-strong); }
.sparo-input-wrapper--error .sparo-input-container { border-color: var(--color-error); }
.sparo-input-wrapper--disabled { opacity: 0.6; }

.sparo-input-container:hover {
  background: var(--element-bg-soft);
  border-color: var(--border-strong);
}

.sparo-input-container:focus-within {
  border-color: var(--color-accent-500);
}

.sparo-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--color-text-primary);
  font: inherit;
}

.sparo-input::placeholder {
  color: color-mix(in srgb, var(--color-text-muted) 52%, transparent);
}

.sparo-input-prefix,
.sparo-input-suffix {
  display: flex;
  align-items: center;
  color: var(--color-text-muted);
}

.sparo-input-error-message {
  color: var(--color-error);
  font-size: var(--font-size-xs);
}

.badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  background: var(--element-bg-base);
  color: var(--color-text-secondary);
}

.badge--accent { background: color-mix(in srgb, var(--color-accent-500) 16%, transparent); color: var(--color-accent-500); }
.badge--success { background: color-mix(in srgb, var(--color-success) 16%, transparent); color: var(--color-success); }
.badge--warning { background: color-mix(in srgb, var(--color-warning) 16%, transparent); color: var(--color-warning); }
.badge--error { background: color-mix(in srgb, var(--color-error) 16%, transparent); color: var(--color-error); }
.badge--info { background: color-mix(in srgb, var(--color-info) 16%, transparent); color: var(--color-info); }

.alert {
  display: flex;
  align-items: flex-start;
  gap: var(--size-gap-3);
  padding: var(--size-gap-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--size-radius-base);
  background: var(--card-bg-subtle);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.alert__icon {
  display: flex;
  flex-shrink: 0;
  margin-top: 1px;
}

.alert__content {
  min-width: 0;
}

.alert__title {
  margin-bottom: 2px;
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
}

.alert__description {
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.alert--success { border-color: color-mix(in srgb, var(--color-success) 32%, transparent); background: color-mix(in srgb, var(--color-success) 10%, transparent); }
.alert--warning { border-color: color-mix(in srgb, var(--color-warning) 32%, transparent); background: color-mix(in srgb, var(--color-warning) 10%, transparent); }
.alert--error { border-color: color-mix(in srgb, var(--color-error) 32%, transparent); background: color-mix(in srgb, var(--color-error) 10%, transparent); }
.alert--info { border-color: color-mix(in srgb, var(--color-info) 32%, transparent); background: color-mix(in srgb, var(--color-info) 10%, transparent); }

.bfui-empty {
  display: grid;
  place-items: center;
  gap: var(--size-gap-2);
  min-height: 120px;
  padding: var(--size-gap-6);
  border: 1px dashed var(--border-base);
  border-radius: var(--size-radius-lg);
  color: var(--color-text-muted);
  text-align: center;
}

.bfui-empty__title {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}

.bfui-empty__description {
  max-width: 36ch;
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);
}
</style>"#
}

/// Runtime helper script that attaches the whitelisted kit to `window.app.ui`.
pub fn build_runtime_ui_kit_script() -> &'static str {
    r#"<script id="sparo-runtime-ui-kit-script">
(function () {
  const COMPONENTS = Object.freeze([
    'Button',
    'Card',
    'CardHeader',
    'CardBody',
    'CardFooter',
    'Input',
    'Badge',
    'Alert',
    'Empty',
    'Stack',
    'Toolbar',
  ]);

  const sizeClass = { small: 'sm', medium: 'base', large: 'lg' };
  const buttonVariantClass = {
    primary: 'btn-primary',
    accent: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    dashed: 'btn-dashed',
    danger: 'btn-action-danger',
    success: 'btn-action-success',
  };

  function append(parent, child) {
    if (child == null || child === false) return parent;
    if (Array.isArray(child)) {
      child.forEach((item) => append(parent, item));
      return parent;
    }
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    return parent;
  }

  function classes(values) {
    return values.filter(Boolean).join(' ');
  }

  function applyAttrs(node, attrs) {
    if (!attrs) return node;
    Object.entries(attrs).forEach(([key, value]) => {
      if (value == null || value === false) return;
      if (key === 'className') node.className = value;
      else if (key === 'dataset' && typeof value === 'object') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (value === true) {
        node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(value));
      }
    });
    return node;
  }

  function createElement(tag, attrs, ...children) {
    const node = document.createElement(tag);
    applyAttrs(node, attrs);
    children.forEach((child) => append(node, child));
    return node;
  }

  function Button(options = {}) {
    const variant = options.variant || 'primary';
    const size = options.size || 'medium';
    const node = createElement('button', {
      type: options.type || 'button',
      className: classes([
        'btn',
        buttonVariantClass[variant] || 'btn-secondary',
        'btn-' + (sizeClass[size] || 'base'),
        options.iconOnly && 'btn-icon-only',
        options.loading && 'btn-loading',
        options.className,
      ]),
      disabled: options.disabled || options.loading,
      title: options.title,
      'aria-label': options.ariaLabel,
      onClick: options.onClick,
    });
    if (options.loading) {
      append(node, createElement('span', { className: 'btn-loading-icon', 'aria-hidden': 'true' }));
      append(node, options.loadingText || 'Loading...');
    } else {
      append(node, options.children ?? options.text);
    }
    return node;
  }

  function Card(options = {}) {
    return createElement('div', {
      className: classes([
        'v-card',
        'v-card--' + (options.variant || 'default'),
        'v-card--padding-' + (options.padding || 'medium'),
        'v-card--radius-' + (options.radius || 'medium'),
        options.interactive && 'v-card--interactive',
        options.fullWidth && 'v-card--full-width',
        options.className,
      ]),
      role: options.role,
      tabIndex: options.tabIndex,
      onClick: options.onClick,
    }, options.children);
  }

  function CardHeader(options = {}) {
    const content = createElement('div', { className: 'v-card-header__content' });
    if (options.title) append(content, createElement('div', { className: 'v-card-header__title' }, options.title));
    if (options.subtitle) append(content, createElement('div', { className: 'v-card-header__subtitle' }, options.subtitle));
    append(content, options.children);
    const header = createElement('div', { className: classes(['v-card-header', options.className]) }, content);
    if (options.extra) append(header, createElement('div', { className: 'v-card-header__extra' }, options.extra));
    return header;
  }

  function CardBody(options = {}) {
    return createElement('div', { className: classes(['v-card-body', options.className]) }, options.children);
  }

  function CardFooter(options = {}) {
    return createElement('div', {
      className: classes(['v-card-footer', 'v-card-footer--' + (options.align || 'right'), options.className]),
    }, options.children);
  }

  function Input(options = {}) {
    const wrapper = createElement('div', {
      className: classes([
        'sparo-input-wrapper',
        'sparo-input-wrapper--' + (options.variant || 'default'),
        'sparo-input-wrapper--' + (options.size || options.inputSize || 'medium'),
        options.error && 'sparo-input-wrapper--error',
        options.disabled && 'sparo-input-wrapper--disabled',
        options.className,
      ]),
    });
    if (options.label) append(wrapper, createElement('label', { className: 'sparo-input-label' }, options.label));
    const container = createElement('div', { className: 'sparo-input-container' });
    if (options.prefix) append(container, createElement('span', { className: 'sparo-input-prefix' }, options.prefix));
    const input = createElement('input', {
      className: 'sparo-input',
      type: options.type || 'text',
      value: options.value,
      placeholder: options.placeholder,
      disabled: options.disabled,
      name: options.name,
      'aria-label': options.ariaLabel || options.label,
      onInput: options.onInput,
      onChange: options.onChange,
    });
    container.appendChild(input);
    if (options.suffix) append(container, createElement('span', { className: 'sparo-input-suffix' }, options.suffix));
    wrapper.appendChild(container);
    if (options.error && options.errorMessage) {
      append(wrapper, createElement('span', { className: 'sparo-input-error-message' }, options.errorMessage));
    } else if (options.hint) {
      append(wrapper, createElement('span', { className: 'sparo-input-error-message' }, options.hint));
    }
    wrapper.input = input;
    return wrapper;
  }

  function Badge(options = {}) {
    return createElement('span', {
      className: classes(['badge', 'badge--' + (options.variant || 'neutral'), options.className]),
    }, options.children ?? options.text);
  }

  function Alert(options = {}) {
    return createElement('div', {
      className: classes(['alert', 'alert--' + (options.type || 'info'), options.className]),
      role: 'alert',
      'aria-live': options.type === 'error' ? 'assertive' : 'polite',
    }, [
      options.icon !== false ? createElement('div', { className: 'alert__icon', 'aria-hidden': 'true' }, options.icon || '!') : null,
      createElement('div', { className: 'alert__content' }, [
        options.title ? createElement('div', { className: 'alert__title' }, options.title) : null,
        createElement('div', { className: 'alert__message' }, options.message || options.children || ''),
        options.description ? createElement('div', { className: 'alert__description' }, options.description) : null,
      ]),
    ]);
  }

  function Empty(options = {}) {
    return createElement('div', { className: classes(['bfui-empty', options.className]) }, [
      options.title ? createElement('div', { className: 'bfui-empty__title' }, options.title) : null,
      options.description ? createElement('div', { className: 'bfui-empty__description' }, options.description) : null,
      options.children,
    ]);
  }

  function Stack(options = {}) {
    const node = createElement('div', {
      className: classes(['bfui-stack', options.direction === 'row' && 'bfui-stack--row', options.className]),
    }, options.children);
    if (options.gap != null) node.style.setProperty('--bfui-gap', typeof options.gap === 'number' ? options.gap + 'px' : String(options.gap));
    return node;
  }

  function Toolbar(options = {}) {
    return createElement('div', { className: classes(['bfui-toolbar', options.className]) }, options.children);
  }

  function mount(target, child) {
    const root = typeof target === 'string' ? document.querySelector(target) : target;
    if (!root) throw new Error('Live App UI Kit mount target not found');
    root.replaceChildren();
    append(root, child);
    return child;
  }

  const ui = Object.freeze({
    version: '0.1.0',
    components: COMPONENTS,
    createElement,
    mount,
    Button,
    Card,
    CardHeader,
    CardBody,
    CardFooter,
    Input,
    Badge,
    Alert,
    Empty,
    Stack,
    Toolbar,
  });

  window.BitfunLiveAppUI = ui;
  if (window.app) {
    window.app.ui = ui;
  }
})();
</script>"#
}

#[cfg(test)]
mod tests {
    use super::{build_runtime_ui_kit_css, build_runtime_ui_kit_script, RUNTIME_UI_KIT_COMPONENTS};

    #[test]
    fn runtime_ui_kit_exports_expected_subset() {
        for component in [
            "Button", "Card", "Input", "Badge", "Alert", "Empty", "Stack", "Toolbar",
        ] {
            assert!(RUNTIME_UI_KIT_COMPONENTS.contains(&component));
        }
    }

    #[test]
    fn runtime_ui_kit_is_host_theme_aligned() {
        let css = build_runtime_ui_kit_css();
        assert!(css.contains("--sparo-bg"));
        assert!(css.contains(".btn-primary"));
        assert!(css.contains(".v-card"));
        assert!(css.contains(".sparo-input-wrapper"));
    }

    #[test]
    fn runtime_ui_kit_attaches_to_window_app_ui() {
        let script = build_runtime_ui_kit_script();
        assert!(script.contains("window.app.ui = ui"));
        assert!(script.contains("Button"));
        assert!(script.contains("Card"));
    }
}
