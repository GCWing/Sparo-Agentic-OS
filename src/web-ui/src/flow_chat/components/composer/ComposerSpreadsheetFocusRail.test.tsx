/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useExcelLiveFocusStore } from '@/app/agentic-os/excel-live/excelLiveFocusStore';
import { ComposerSpreadsheetFocusRail } from './ComposerSpreadsheetFocusRail';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const labels = {
  included: 'Spreadsheet focus included',
  excluded: 'Spreadsheet focus excluded',
  includeAction: 'Include with next message',
  excludeAction: 'Exclude from next message',
  partialCache: 'Selection preview is incomplete',
  staleFormulas: 'Formula results are stale',
  modes: {
    inspect: 'Inspect',
    edit: 'Edit',
    author: 'Author',
  },
};

describe('ComposerSpreadsheetFocusRail', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useExcelLiveFocusStore.setState({ ambient: null, ambientBySessionId: {}, includeOnSend: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows grounded revision and cache state and toggles send inclusion', () => {
    act(() => {
      useExcelLiveFocusStore.getState().setAmbientFocus({
        sessionId: 'session-1',
        workbookId: 'workbook-1',
        sheetId: 'sheet-1',
        sheetName: 'Revenue',
        a1: 'B2:D4',
        mode: 'inspect',
        revision: 17,
        cacheCoverage: 0.5,
        cacheComplete: false,
        capturedAt: 1_700_000_000_000,
      });
      root.render(
        <ComposerSpreadsheetFocusRail
          labels={labels}
          sessionId="session-1"
        />,
      );
    });

    const focusPill = container.querySelector('.sparo-chat-input__spreadsheet-focus');
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(focusPill?.textContent).toContain('Revenue!B2:D4');
    expect(focusPill?.textContent).toContain('Inspect · r17');
    expect(button?.getAttribute('aria-label')).toContain('Selection preview is incomplete');
    expect(button?.getAttribute('aria-pressed')).toBe('true');

    act(() => button?.click());
    expect(useExcelLiveFocusStore.getState().includeOnSend).toBe(false);
    expect(button?.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not expose focus from a different chat session', () => {
    act(() => {
      useExcelLiveFocusStore.getState().setAmbientFocus({
        sessionId: 'session-2',
        workbookId: 'workbook-1',
        sheetId: 'sheet-1',
        sheetName: 'Revenue',
        a1: 'A1',
        cacheComplete: true,
      });
      root.render(
        <ComposerSpreadsheetFocusRail
          labels={labels}
          sessionId="session-1"
        />,
      );
    });

    expect(container.querySelector('button')).toBeNull();
  });
});
