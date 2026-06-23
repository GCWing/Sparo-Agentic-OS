import React from 'react';
import { MarkdownRenderer } from '@/shared/markdown';
import './Preview.scss';

interface PreviewProps {
  value: string;
  basePath?: string;
}

export const Preview: React.FC<PreviewProps> = ({ value, basePath }) => {
  return (
    <div className="m-editor-preview">
      <div className="m-editor-preview-content">
        <MarkdownRenderer
          content={value}
          basePath={basePath}
          className="m-editor-preview-markdown"
        />
      </div>
    </div>
  );
};
