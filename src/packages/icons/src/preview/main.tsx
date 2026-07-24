import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { IconPreviewApp } from './IconPreviewApp';
import './preview.scss';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Icon preview root is missing.');
}

createRoot(root).render(
  <StrictMode>
    <IconPreviewApp />
  </StrictMode>,
);
