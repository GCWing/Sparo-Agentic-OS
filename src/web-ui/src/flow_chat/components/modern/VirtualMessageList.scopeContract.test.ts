import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const listSource = readFileSync(new URL('./VirtualMessageList.tsx', import.meta.url), 'utf8');
const standardContainerSource = readFileSync(
  new URL('./StandardFlowChatContainer.tsx', import.meta.url),
  'utf8',
);
const agenticContainerSource = readFileSync(
  new URL('./AgenticOSFlowChatContainer.tsx', import.meta.url),
  'utf8',
);
const scrollAnchorSource = readFileSync(new URL('./ScrollAnchor.tsx', import.meta.url), 'utf8');

describe('VirtualMessageList session scope contract', () => {
  it('renders the session and projection owned by its containing surface', () => {
    expect(listSource).toContain('session: Session | null');
    expect(listSource).toContain('virtualItems: VirtualItem[]');
    expect(listSource).not.toMatch(/\buseActiveSession(?:State)?\b/);
    expect(listSource).not.toMatch(/\buseVirtualItems\b/);
    expect(listSource).toContain(
      'useSessionStateMachine(activeSession?.sessionId ?? null)',
    );
  });

  it('passes the same scoped session and items from every FlowChat container', () => {
    for (const source of [standardContainerSource, agenticContainerSource]) {
      expect(source).toContain('session: scopedSession');
      expect(source).toMatch(
        /<VirtualMessageList[\s\S]*?session=\{scopedSession\}[\s\S]*?virtualItems=\{virtualItems\}/,
      );
    }
  });

  it('keeps the turn anchor on the list projection instead of the global projection', () => {
    expect(listSource).toMatch(
      /<ScrollAnchor[\s\S]*?virtualItems=\{virtualItems\}/,
    );
    expect(scrollAnchorSource).toContain('virtualItems: VirtualItem[]');
    expect(scrollAnchorSource).not.toMatch(/\buseVirtualItems\b/);
  });
});
