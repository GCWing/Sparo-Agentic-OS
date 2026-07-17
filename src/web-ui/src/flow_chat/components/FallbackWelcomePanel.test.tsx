import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FallbackWelcomePanel } from './FallbackWelcomePanel';

const standardContainerSource = readFileSync(
  new URL('./modern/StandardFlowChatContainer.tsx', import.meta.url),
  'utf8',
);
const virtualMessageListSource = readFileSync(
  new URL('./modern/VirtualMessageList.tsx', import.meta.url),
  'utf8',
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'welcome.fallback.heading': 'Start a new conversation',
        'welcome.fallback.tagline': 'Share an idea, question, or request below.',
        'welcome.fallback.narrative': 'Messages and progress will appear here.',
      };
      return translations[key] ?? key;
    },
  }),
}));

describe('FallbackWelcomePanel', () => {
  it('renders the shared WelcomePanel layout with neutral empty-state copy', () => {
    const html = renderToStaticMarkup(<FallbackWelcomePanel />);

    expect(html).toContain('flow-chat-fallback-welcome');
    expect(html).toContain('welcome-panel__heading');
    expect(html).toContain('Start a new conversation');
    expect(html).toContain('Share an idea, question, or request below.');
    expect(html).toContain('Messages and progress will appear here.');
  });

  it('owns both the profile-neutral empty state and the list-level fallback', () => {
    expect(standardContainerSource).toContain('<FallbackWelcomePanel />');
    expect(virtualMessageListSource).toContain('<FallbackWelcomePanel />');
  });
});
