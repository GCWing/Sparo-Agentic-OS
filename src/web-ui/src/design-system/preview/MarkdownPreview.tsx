/**
 * Markdown preview page
 */

import React, { useState } from 'react';
import { Markdown } from '@/shared/markdown';
import { Button } from '@/design-system/primitives/Button';
import { useI18n } from '@/infrastructure/i18n';
import './markdown-preview.css';

export const MarkdownPreview: React.FC = () => {
  const { t } = useI18n('components');
  const getSampleMarkdown = () => t('designSystem.markdownPreview.sample');
  const [content, setContent] = useState(() => getSampleMarkdown());
  const [variant, setVariant] = useState<'default' | 'bordered' | 'minimal'>('default');
  const [activeTab, setActiveTab] = useState<'preview' | 'edit'>('preview');

  return (
    <div className="markdown-preview-page">
      <header className="markdown-preview-header">
        <div className="header-left">
          <h1>{t('designSystem.markdownPreview.title')}</h1>
          <span className="badge">{t('designSystem.markdownPreview.badge')}</span>
        </div>
        <div className="header-right">
          <Button
            variant="ghost"
            size="small"
            onClick={() => window.location.href = '/preview.html'}
          >
            {t('designSystem.markdownPreview.backToLibrary')}
          </Button>
        </div>
      </header>

      <div className="markdown-controls">
        <div className="control-group">
          <label>{t('designSystem.markdownPreview.controls.variantLabel')}</label>
          <div className="button-group">
            <Button
              variant={variant === 'default' ? 'primary' : 'secondary'}
              size="small"
              onClick={() => setVariant('default')}
            >
              {t('designSystem.markdownPreview.variants.default')}
            </Button>
            <Button
              variant={variant === 'bordered' ? 'primary' : 'secondary'}
              size="small"
              onClick={() => setVariant('bordered')}
            >
              {t('designSystem.markdownPreview.variants.bordered')}
            </Button>
            <Button
              variant={variant === 'minimal' ? 'primary' : 'secondary'}
              size="small"
              onClick={() => setVariant('minimal')}
            >
              {t('designSystem.markdownPreview.variants.minimal')}
            </Button>
          </div>
        </div>

        <div className="control-group">
          <label>{t('designSystem.markdownPreview.controls.modeLabel')}</label>
          <div className="button-group">
            <Button
              variant={activeTab === 'preview' ? 'primary' : 'secondary'}
              size="small"
              onClick={() => setActiveTab('preview')}
            >
              {t('designSystem.markdownPreview.controls.preview')}
            </Button>
            <Button
              variant={activeTab === 'edit' ? 'primary' : 'secondary'}
              size="small"
              onClick={() => setActiveTab('edit')}
            >
              {t('designSystem.markdownPreview.controls.edit')}
            </Button>
          </div>
        </div>

        <div className="control-group">
          <Button
            variant="ghost"
            size="small"
            onClick={() => setContent(getSampleMarkdown())}
          >
            {t('designSystem.markdownPreview.controls.reset')}
          </Button>
        </div>
      </div>

      <div className="markdown-preview-main">
        {activeTab === 'preview' ? (
          <div className="preview-container">
            <div className={`markdown-preview-surface markdown-preview-surface--${variant}`}>
              <Markdown content={content} />
            </div>
          </div>
        ) : (
          <div className="editor-container">
            <textarea
              className="markdown-editor"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('designSystem.markdownPreview.editorPlaceholder')}
            />
          </div>
        )}
      </div>
    </div>
  );
};
