/**
 * Button to copy a dialog turn output.
 * Copies all AI text and tool calls from the turn.
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Edit } from 'lucide-react';
import type { DialogTurn, FlowTextItem, FlowToolItem, FlowThinkingItem } from '../types/flow-chat';
import { createMarkdownEditorTab } from '@/shared/utils/tabUtils';
import { Button, Tooltip } from '@/design-system';
import { i18nService } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import './CopyOutputButton.css';

const log = createLogger('CopyOutputButton');

interface CopyOutputButtonProps {
  dialogTurn: DialogTurn;
  className?: string;
}

export const CopyOutputButton: React.FC<CopyOutputButtonProps> = ({
  dialogTurn,
  className = ''
}) => {
  const { t } = useTranslation('flow-chat');
  const [copied, setCopied] = useState(false);

  const extractOutputContent = useCallback((dialogTurn: DialogTurn): string => {
    const contentParts: string[] = [];

    dialogTurn.modelRounds.forEach((modelRound) => {
      const sortedItems = [...modelRound.items].sort((a, b) => a.timestamp - b.timestamp);

      sortedItems.forEach((item) => {
        if (item.type === 'text') {
          const textItem = item as FlowTextItem;
          if (textItem.content.trim()) {
            contentParts.push(textItem.content.trim());
          }
        } else if (item.type === 'thinking') {
          const thinkingItem = item as FlowThinkingItem;
          if (thinkingItem.content.trim()) {
            contentParts.push(`[Thinking]\n${thinkingItem.content.trim()}`);
          }
        } else if (item.type === 'tool') {
          const toolItem = item as FlowToolItem;
          
          if (toolItem.toolCall) {
            const toolName = toolItem.toolName || t('copyOutput.unknownTool');
            let toolContent = t('copyOutput.toolCall', { name: toolName }) + '\n';
            
            if (toolItem.toolCall.input) {
              const inputStr = typeof toolItem.toolCall.input === 'string'
                ? toolItem.toolCall.input
                : JSON.stringify(toolItem.toolCall.input, null, 2);
              toolContent += `\n[Input]\n\`\`\`json\n${inputStr}\n\`\`\`\n`;
            }
            
            if (toolItem.toolResult) {
              if (toolItem.toolResult.error) {
                toolContent += `\n[Error]\n${toolItem.toolResult.error}\n`;
              } else if (toolItem.toolResult.result !== undefined) {
                const resultStr = typeof toolItem.toolResult.result === 'string'
                  ? toolItem.toolResult.result
                  : JSON.stringify(toolItem.toolResult.result, null, 2);
                toolContent += `\n[Result]\n\`\`\`\n${resultStr}\n\`\`\`\n`;
              }
            }
            
            contentParts.push(toolContent.trim());
          }
        }
      });
    });

    return contentParts.join('\n\n');
  }, [t]);

  const handleCopy = useCallback(async () => {
    try {
      const content = extractOutputContent(dialogTurn);
      if (!content.trim()) {
        log.warn('No content to copy');
        return;
      }

      await navigator.clipboard.writeText(content);
      setCopied(true);
      
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      log.error('Failed to copy', error);
    }
  }, [dialogTurn, extractOutputContent]);

  const handleOpenInEditor = useCallback(() => {
    try {
      const content = extractOutputContent(dialogTurn);
      if (!content.trim()) {
        log.warn('No content to edit');
        return;
      }

      const timestamp = i18nService.formatDate(new Date(), {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      }).replace(/\//g, '-');

      createMarkdownEditorTab(
        t('copyOutput.aiReply', { timestamp }),
        content,
        undefined,
        undefined,
        'agent'
      );

      log.debug('AI reply opened in editor');
    } catch (error) {
      log.error('Failed to open editor', error);
    }
  }, [dialogTurn, extractOutputContent, t]);

  const hasContent = dialogTurn.modelRounds.some(round => 
    round.items.some(item => 
      (item.type === 'text' && (item as FlowTextItem).content.trim()) ||
      (item.type === 'tool' && (item as FlowToolItem).toolCall)
    )
  );

  if (!hasContent) {
    return null;
  }

  return (
    <div className={`copy-output-actions ${className}`}>
      <Button
        type="button"
        variant={copied ? 'success' : 'secondary'}
        size="small"
        className={`copy-output-action ${copied ? 'copied' : ''}`}
        onClick={handleCopy}
        title={copied ? t('copyOutput.copiedOutputContent') : t('copyOutput.copyOutputContent')}
        aria-label={copied ? t('copyOutput.copiedOutputContent') : t('copyOutput.copyOutputContent')}
      >
        <span className="action-icon">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </span>
        <span className="action-text">
          {copied ? t('copyOutput.copied') : t('copyOutput.copy')}
        </span>
      </Button>
      
      <Tooltip content={t('copyOutput.openInEditor')}>
        <Button
          type="button"
          variant="secondary"
          size="small"
          className="copy-output-action edit-action"
          onClick={handleOpenInEditor}
          aria-label={t('copyOutput.openInEditor')}
        >
          <span className="action-icon">
            <Edit size={14} />
          </span>
          <span className="action-text">
            {t('copyOutput.edit')}
          </span>
        </Button>
      </Tooltip>
    </div>
  );
};
