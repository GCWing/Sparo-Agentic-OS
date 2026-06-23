import React from 'react';
import { MarkdownRenderer } from '@/shared/markdown';
import type { MarkdownExportFormat } from './markdownExportStyles';

export interface MarkdownExportDocumentProps {
  markdown: string;
  basePath?: string;
  format: MarkdownExportFormat;
}

export const MarkdownExportDocument: React.FC<MarkdownExportDocumentProps> = ({
  markdown,
  basePath,
  format,
}) => {
  return (
    <article className="markdown-export-document" data-export-format={format}>
      <MarkdownRenderer
        content={markdown}
        basePath={basePath}
        className="m-editor-preview-markdown markdown-export-document__markdown"
        renderMode="static-export"
        expandDetailsByDefault={format === 'pdf'}
      />
    </article>
  );
};
