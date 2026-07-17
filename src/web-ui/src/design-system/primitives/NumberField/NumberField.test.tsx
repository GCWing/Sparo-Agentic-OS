// @vitest-environment jsdom

import React, { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { NumberField } from './NumberField';

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('NumberField nullable contract', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('renders null as an empty, labelled spinbutton without synthetic progress', () => {
    act(() => {
      root.render(
        <NumberField
          nullable
          value={null}
          min={0}
          max={100}
          unit="s"
          placeholder="Not set"
          onChange={() => undefined}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>('input');
    expect(input?.value).toBe('');
    expect(input?.placeholder).toBe('Not set');
    expect(input?.getAttribute('role')).toBe('spinbutton');
    expect(input?.getAttribute('aria-valuetext')).toBe('Not set');
    expect(input?.hasAttribute('aria-valuenow')).toBe(false);
    expect(container.querySelector('.ds-number-field__unit')).toBeNull();
    expect(container.querySelector('.ds-number-field__progress')).toBeNull();
  });

  it('commits null exactly once when a nullable value is cleared with Enter', () => {
    const onChange = vi.fn();

    function Harness() {
      const [value, setValue] = useState<number | null>(12);
      return (
        <NumberField
          nullable
          value={value}
          onChange={(nextValue) => {
            onChange(nextValue);
            setValue(nextValue);
          }}
        />
      );
    }

    act(() => root.render(<Harness />));
    const input = container.querySelector<HTMLInputElement>('input')!;

    act(() => {
      input.focus();
      setInputValue(input, '');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(input.value).toBe('');
  });

  it('restores a required value when the input is cleared', () => {
    const onChange = vi.fn();
    act(() => root.render(<NumberField value={12} onChange={onChange} />));
    const input = container.querySelector<HTMLInputElement>('input')!;

    act(() => {
      input.focus();
      setInputValue(input, '');
      input.blur();
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('12');
  });
});
