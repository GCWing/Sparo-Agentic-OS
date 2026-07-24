// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { SettingDescriptor } from '../catalog/types';

const { useSettingMock } = vi.hoisted(() => ({
  useSettingMock: vi.fn(),
}));

vi.mock('../hooks/useSetting', () => ({
  useSetting: useSettingMock,
}));

import { SettingRenderer } from './SettingRenderer';

const nullableIntegerDescriptor: SettingDescriptor = {
  id: 'core.ai.stream_idle_timeout_secs',
  exposure: 'formal',
  valueSchema: {
    type: 'integer',
    nullable: true,
    minimum: 0,
  },
  defaultValue: { kind: 'value', value: null },
  presentation: {
    categoryId: 'ai',
    tabId: 'models',
    sectionId: 'runtime',
    fieldId: 'stream-idle-timeout',
    titleKey: 'settings/config-center:fields.streamIdleTimeout',
    control: 'number',
    order: 1,
    hidden: false,
  },
  ai: {
    aliases: [],
    tags: [],
    readable: true,
    writable: true,
  },
  policy: {
    risk: 'safe',
    sensitivity: 'public',
    mutability: 'writable',
    applyStrategy: 'reactive',
  },
  source: { kind: 'core' },
};

function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SettingRenderer nullable number projection', () => {
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
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps a nullable integer visible and commits a number from the empty state', async () => {
    const setValue = vi.fn().mockResolvedValue(undefined);
    useSettingMock.mockReturnValue({
      descriptor: nullableIntegerDescriptor,
      storedValue: { kind: 'value', value: null },
      value: null,
      revision: 7,
      isLoading: false,
      isSaving: false,
      error: null,
      setValue,
    });

    await act(async () => {
      root.render(
        <SettingRenderer
          settingId={nullableIntegerDescriptor.id}
          translate={(key) => key === 'settings/ai-mode:values.notSet' ? 'Not set' : key}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>('input');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('');
    expect(input?.placeholder).toBe('Not set');
    expect(container.querySelector('.ds-form-field--horizontal')).not.toBeNull();
    expect(container.querySelector('.ds-form-field--control-compact')).not.toBeNull();
    expect(container.querySelector('label')?.textContent).toBe(
      nullableIntegerDescriptor.presentation.titleKey,
    );

    await act(async () => {
      input!.focus();
      setInputValue(input!, '30');
      input!.blur();
      await Promise.resolve();
    });

    expect(setValue).toHaveBeenCalledWith(30);
  });
});
