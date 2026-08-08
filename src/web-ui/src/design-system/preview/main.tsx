/**
 * Component preview entry
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { CompactToolCardQuickPreview } from './CompactToolCardQuickPreview';
import { PreviewApp } from './PreviewApp';
import { i18nService } from '@/infrastructure/i18n';
import './preview.css';
import './flowchat-cards-preview.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('qa') === 'compact-tool-card'
      ? <CompactToolCardQuickPreview />
      : (
        <I18nextProvider i18n={i18nService.getI18nInstance()}>
          <PreviewApp />
        </I18nextProvider>
      )}
  </React.StrictMode>
);
