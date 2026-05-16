import type { CssVarMap } from './css-var-map';

export function applyCssVars(root: HTMLElement, vars: CssVarMap): void {
  Object.entries(vars).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
}
