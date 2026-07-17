import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('./SettingsScene.scss', import.meta.url), 'utf8');
const sceneSource = readFileSync(new URL('./SettingsScene.tsx', import.meta.url), 'utf8');
const aiModeSource = readFileSync(new URL('./SettingsAIMode.tsx', import.meta.url), 'utf8');
const settingsModeSwitchSource = readFileSync(new URL('./SettingsModeSwitch.tsx', import.meta.url), 'utf8');
const appCenterModeSwitchSource = readFileSync(
  new URL('../apps/components/AppCenterModeNav.tsx', import.meta.url),
  'utf8',
);
const modeSwitchStylesheet = readFileSync(
  new URL('../../../design-system/primitives/ModeSwitch/ModeSwitch.scss', import.meta.url),
  'utf8',
);
const embeddedSurfaceStylesheet = readFileSync(
  new URL('../../../flow_chat/components/FlowChatSessionSurface.scss', import.meta.url),
  'utf8',
);
const welcomeStylesheet = readFileSync(
  new URL('../../../flow_chat/components/WelcomePanel.css', import.meta.url),
  'utf8',
);

describe('Settings AI layout contract', () => {
  it('uses one rail width variable for navigation and full-page AI centering', () => {
    expect(stylesheet).toContain('--sparo-settings-rail-width: 220px');
    expect(stylesheet).toContain('width: var(--sparo-settings-rail-width)');
    expect(stylesheet).toContain('flex: 0 0 var(--sparo-settings-rail-width)');
    expect(stylesheet).toContain(
      'padding-inline-end: var(--sparo-settings-rail-width)',
    );
  });

  it('extends the AI transcript scrollbar and session action to the scene edge', () => {
    expect(stylesheet).toMatch(
      /&__content-panel \{[\s\S]*?&--ai \{[\s\S]*?overflow: visible/,
    );
    expect(stylesheet).toMatch(
      /\.sparo-settings-ai-mode \{[\s\S]*?overflow: visible/,
    );
    expect(stylesheet).toMatch(
      /&__toolbar \{[\s\S]*?width: calc\(100% \+ var\(--sparo-settings-rail-width\)\)/,
    );
    expect(stylesheet).toMatch(
      /&__chat \{[\s\S]*?width: calc\(100% \+ var\(--sparo-settings-rail-width\)\)[\s\S]*?\[data-virtuoso-scroller\][\s\S]*?padding-inline-end: var\(--sparo-settings-rail-width\)/,
    );
    expect(aiModeSource).toContain('className="sparo-settings-ai-mode__chat"');
  });

  it('uses a circular emphasized icon button for a new conversation', () => {
    expect(aiModeSource).toContain('IconButton');
    expect(aiModeSource).toContain('variant="accent"');
    expect(aiModeSource).toContain('shape="circle"');
    expect(aiModeSource).toContain('MessageSquarePlus');
    expect(aiModeSource).toContain("aria-label={resetting ? t('session.resetting') : t('session.newConversation')}");
  });

  it('aligns the new-conversation action with the mode switch row', () => {
    expect(stylesheet).toContain('--sparo-settings-top-control-row-height: 46px');
    expect(stylesheet).toMatch(
      /&__mode-switch \{[\s\S]*?align-items: center;[\s\S]*?min-height: var\(--sparo-settings-top-control-row-height\)/,
    );
    expect(stylesheet).toMatch(
      /&__toolbar \{[\s\S]*?align-items: center;[\s\S]*?min-height: var\(--sparo-settings-top-control-row-height\)[\s\S]*?padding: var\(--ds-space-2, 8px\)[\s\S]*?var\(--ds-space-1, 4px\)/,
    );
  });

  it('uses the compact rail before the 800px desktop minimum becomes cramped', () => {
    expect(stylesheet).toMatch(
      /@media \(max-width: 960px\)[\s\S]*--sparo-settings-rail-width: 190px/,
    );
  });

  it('keeps settings prompt actions readable from the embedded conversation width', () => {
    expect(embeddedSurfaceStylesheet).toContain(
      'container: flow-chat-session / inline-size',
    );
    expect(welcomeStylesheet).toMatch(
      /@container flow-chat-session \(max-width: 560px\)[\s\S]*?\.welcome-panel__settings-prompt-copy \{[\s\S]*?grid-template-columns: 1fr/,
    );
  });

  it('animates manual navigation out while keeping the AI rail semantically empty', () => {
    expect(sceneSource).toContain("element?.toggleAttribute('inert', mode !== 'manual')");
    expect(sceneSource).toContain('aria-hidden={mode !== \'manual\'}');
    expect(sceneSource).toContain('sparo-settings-scene__nav-panel--manual');
    expect(sceneSource).not.toContain('sparo-settings-scene__nav-panel--ai');
    expect(stylesheet).toMatch(
      /&__nav-panel \{[\s\S]*?opacity: 0[\s\S]*?pointer-events: none[\s\S]*?transition:/,
    );
    expect(stylesheet).toMatch(
      /\.sparo-settings-scene--ai \.sparo-settings-scene__nav \{[\s\S]*?border-right-color: transparent/,
    );
  });

  it('uses the compact App Center mode-switch primitive without shadows', () => {
    for (const source of [settingsModeSwitchSource, appCenterModeSwitchSource]) {
      expect(source).toContain("import { ModeSwitch } from '@/design-system'");
      expect(source).toContain('appearance="slider"');
    }
    expect(settingsModeSwitchSource).not.toMatch(/\s+stretch(?:\s|\/?>)/);
    expect(modeSwitchStylesheet).toMatch(
      /\.ds-mode-switch--slider \{[\s\S]*?box-shadow: none/,
    );
    expect(modeSwitchStylesheet).toMatch(
      /\.ds-segmented-control__item \{[\s\S]*?box-shadow: none/,
    );
  });

  it('disables mode-transition motion when reduced motion is requested', () => {
    expect(stylesheet).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.sparo-settings-scene__content[\s\S]*?transition: none/,
    );
  });
});
