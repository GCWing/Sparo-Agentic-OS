/**
 * @vitest-environment jsdom
 */

import React, { useEffect, useRef, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentAction } from '../../../reducers/agentReducer';
import {
  type ComposerCommandInteractionState,
} from '../model/composerState';
import { useComposerOutsideInteractions } from './useComposerOutsideInteractions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const tokenKey = 'start:0:2:/g';

function Probe({
  onCommandState,
}: {
  onCommandState: (state: ComposerCommandInteractionState) => void;
}) {
  const agentBoostRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [commandState, setCommandState] = useState<ComposerCommandInteractionState>({
    isOpen: true,
    query: 'g',
    selectedIndex: 0,
    dismissedTokenKey: null,
  });
  const [, setSkillsFlyoutOpen] = useState(false);

  useComposerOutsideInteractions({
    agentBoostRef,
    containerRef,
    dispatchMode: vi.fn<[AgentAction], void>(),
    dropdownOpen: false,
    slashCommandOpen: commandState.isOpen,
    slashCommandTokenKey: tokenKey,
    setCommandState,
    setSkillsFlyoutOpen,
  });

  useEffect(() => {
    onCommandState(commandState);
  }, [commandState, onCommandState]);

  return (
    <div ref={containerRef}>
      <div ref={agentBoostRef} />
      <div className="rich-text-input" data-testid="editor" />
      <div className="sparo-chat-input__slash-command-picker" data-testid="picker" />
      <button data-testid="other-composer-control" type="button">Other</button>
    </div>
  );
}

function mouseDown(element: Element) {
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

describe('useComposerOutsideInteractions', () => {
  let host: HTMLDivElement;
  let root: Root;
  let latestState: ComposerCommandInteractionState | undefined;

  beforeEach(() => {
    latestState = undefined;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('keeps slash commands open when clicking the picker or editor', () => {
    act(() => {
      root.render(<Probe onCommandState={state => { latestState = state; }} />);
    });

    const picker = host.querySelector('[data-testid="picker"]');
    const editor = host.querySelector('[data-testid="editor"]');
    expect(picker).not.toBeNull();
    expect(editor).not.toBeNull();

    act(() => {
      mouseDown(picker!);
      mouseDown(editor!);
    });

    expect(latestState).toMatchObject({
      isOpen: true,
      dismissedTokenKey: null,
    });
  });

  it('dismisses the active slash token when clicking another composer control', () => {
    act(() => {
      root.render(<Probe onCommandState={state => { latestState = state; }} />);
    });

    const otherControl = host.querySelector('[data-testid="other-composer-control"]');
    expect(otherControl).not.toBeNull();

    act(() => {
      mouseDown(otherControl!);
    });

    expect(latestState).toMatchObject({
      isOpen: false,
      query: '',
      selectedIndex: 0,
      dismissedTokenKey: tokenKey,
    });
  });
});
