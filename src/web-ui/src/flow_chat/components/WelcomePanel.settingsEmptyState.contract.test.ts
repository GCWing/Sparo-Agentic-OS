import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./WelcomePanel.tsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('./WelcomePanel.css', import.meta.url), 'utf8');

describe('Settings WelcomePanel empty-state contract', () => {
  it('uses a settings-only visual hierarchy without changing other welcome profiles', () => {
    expect(source).toContain("isSettingsWelcome && 'welcome-panel--settings'");
    expect(source).not.toContain('welcome-panel__settings-kicker');
    expect(stylesheet).toMatch(
      /\.welcome-panel--settings \.welcome-panel__content \{[\s\S]*?max-width: 600px;[\s\S]*?gap: 0;/,
    );
    expect(stylesheet).toMatch(
      /\.welcome-panel--settings \.welcome-panel__divider,[\s\S]*?\.welcome-panel--settings \.welcome-panel__narrative \{[\s\S]*?display: none;/,
    );
  });

  it('renders examples as simple aligned text rows', () => {
    expect(source).toContain('welcome-panel__settings-prompts-list');
    expect(source).toContain('welcome-panel__settings-prompt-copy');
    expect(source).not.toContain('welcome-panel__settings-prompt-index');
    expect(stylesheet).toContain('.welcome-panel__settings-prompt.btn');
    expect(stylesheet).not.toContain('.welcome-panel__settings-prompt.ds-button');
    expect(stylesheet).toContain('grid-template-columns: minmax(0, 1fr) 20px');
    expect(stylesheet).toContain('grid-template-columns: minmax(132px, 0.8fr) minmax(0, 1.2fr)');
    expect(stylesheet).not.toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
  });

  it('responds to the embedded FlowChat container instead of only the viewport', () => {
    expect(stylesheet).toMatch(
      /@container flow-chat-session \(max-width: 560px\)[\s\S]*?\.welcome-panel__settings-prompt-copy \{[\s\S]*?grid-template-columns: 1fr/,
    );
  });
});
