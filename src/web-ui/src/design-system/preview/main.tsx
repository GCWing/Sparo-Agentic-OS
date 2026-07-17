/**
 * Component preview entry
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { CompactToolCardQuickPreview } from './CompactToolCardQuickPreview';
import { PreviewApp } from './PreviewApp';
import './preview.css';
import './flowchat-cards-preview.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).get('qa') === 'compact-tool-card'
      ? <CompactToolCardQuickPreview />
      : <PreviewApp />}
  </React.StrictMode>
);
