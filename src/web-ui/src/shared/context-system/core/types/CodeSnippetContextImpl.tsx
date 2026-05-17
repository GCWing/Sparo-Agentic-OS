

import React from 'react';
import { Code } from 'lucide-react';
import type { CodeSnippetContext, ValidationResult, RenderOptions } from '../../../types/context';
import type {
  ContextTransformer,
  ContextValidator,
  ContextCardRenderer
} from '../../../services/ContextRegistry';
import { i18nService } from '@/infrastructure/i18n';
import { IconButton } from '@/design-system';



export class CodeSnippetContextTransformer implements ContextTransformer<'code-snippet'> {
  readonly type = 'code-snippet' as const;

  transform(context: CodeSnippetContext): unknown {
    return {
      type: 'code_snippet',
      file: context.filePath,
      lines: {
        start: context.startLine,
        end: context.endLine
      },
      content: context.selectedText,
      language: context.language,
      context: {
        before: context.beforeContext,
        after: context.afterContext
      }
    };
  }

  estimateSize(context: CodeSnippetContext): number {
    let size = context.selectedText.length;
    if (context.beforeContext) size += context.beforeContext.length;
    if (context.afterContext) size += context.afterContext.length;
    return size;
  }
}



export class CodeSnippetContextValidator implements ContextValidator<'code-snippet'> {
  readonly type = 'code-snippet' as const;

  async validate(context: CodeSnippetContext): Promise<ValidationResult> {
    const warnings: string[] = [];


    if (context.startLine < 1) {
      return { valid: false, error: 'Start line must be greater than 0.' };
    }

    if (context.endLine < context.startLine) {
      return { valid: false, error: 'End line must be greater than or equal to start line.' };
    }


    const lineCount = context.endLine - context.startLine + 1;
    if (lineCount > 500) {
      warnings.push(i18nService.t('components:contextSystem.validation.warnings.codeLinesLarge', { max: 500 }));
    }

    if (context.selectedText.length > 50000) {
      warnings.push(i18nService.t('components:contextSystem.validation.warnings.codeContentLarge', { maxChars: 50000 }));
    }


    if (!context.selectedText || context.selectedText.trim() === '') {
      return { valid: false, error: 'Selected code is empty.' };
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  quickValidate(context: CodeSnippetContext): ValidationResult {
    if (!context.selectedText || context.selectedText.trim() === '') {
      return { valid: false, error: 'Code content is empty.' };
    }

    if (context.startLine < 1 || context.endLine < context.startLine) {
      return { valid: false, error: 'Invalid line range.' };
    }

    return { valid: true };
  }
}



export class CodeSnippetCardRenderer implements ContextCardRenderer<'code-snippet'> {
  readonly type = 'code-snippet' as const;

  render(context: CodeSnippetContext, options?: RenderOptions): React.ReactNode {
    const { compact = false, interactive = true, showPreview = true } = options || {};

    const lineCount = context.endLine - context.startLine + 1;
    const previewText = compact
      ? context.selectedText.slice(0, 50) + (context.selectedText.length > 50 ? '...' : '')
      : context.selectedText.split('\n').slice(0, 3).join('\n');

    return (
      <div className={`sparo-context-card sparo-context-card--code-snippet ${compact ? 'sparo-context-card--compact' : ''}`}>
        <div className="sparo-context-card__icon">
          <Code size={compact ? 16 : 20} />
        </div>

        <div className="sparo-context-card__content">
          <div className="sparo-context-card__title">
            {context.fileName}
            <span className="sparo-context-card__badge">
              L{context.startLine}-{context.endLine}
            </span>
          </div>

          {!compact && (
            <>
              <div className="sparo-context-card__subtitle">
                {lineCount} {lineCount === 1 ? 'line' : 'lines'}
                {context.language && (
                  <span className="sparo-context-card__meta">
                    {' - '}{context.language}
                  </span>
                )}
              </div>

              {showPreview && (
                <div className="sparo-context-card__preview">
                  <code className="sparo-context-card__code">
                    {previewText}
                  </code>
                </div>
              )}
            </>
          )}
        </div>

        {interactive && (
          <div className="sparo-context-card__actions">
            <IconButton
              className="sparo-context-card__action-btn"
              aria-label={i18nService.t('components:contextSystem.contextCard.viewFullCode')}
              tooltip={i18nService.t('components:contextSystem.contextCard.viewFullCode')}
              size="xs"
              variant="ghost"
            >
              <Code size={14} />
            </IconButton>
          </div>
        )}
      </div>
    );
  }
}



export function getLanguageDisplayName(language?: string): string {
  const langMap: Record<string, string> = {
    'javascript': 'JavaScript',
    'typescript': 'TypeScript',
    'python': 'Python',
    'rust': 'Rust',
    'go': 'Go',
    'java': 'Java',
    'cpp': 'C++',
    'c': 'C',
    'csharp': 'C#',
    'html': 'HTML',
    'css': 'CSS',
    'scss': 'SCSS',
    'json': 'JSON',
    'yaml': 'YAML',
    'markdown': 'Markdown'
  };

  return language ? (langMap[language] || language) : 'Text';
}

export function getLanguageColor(language?: string): string {
  const colorMap: Record<string, string> = {
    'javascript': 'var(--ds-color-warning)',
    'typescript': 'var(--ds-color-accent-600)',
    'python': 'var(--ds-color-accent-500)',
    'rust': 'var(--ds-color-text-primary)',
    'go': 'var(--ds-color-info)',
    'java': 'var(--ds-color-warning)',
    'html': 'var(--ds-color-danger)',
    'css': 'var(--ds-color-info)',
    'scss': 'var(--ds-color-purple-500)'
  };

  return language ? (colorMap[language] || 'var(--ds-color-text-muted)') : 'var(--ds-color-text-muted)';
}
