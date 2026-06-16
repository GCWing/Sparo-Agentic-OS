/**
 * Model round item component.
 * Renders mixed FlowItems (text + tools).
 *
 * Note: explore-only rounds are handled by ExploreGroupRenderer,
 * and this component only renders rounds with critical output.
 */

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check } from 'lucide-react';
import type { ModelRound, FlowItem, FlowTextItem, FlowToolItem, FlowThinkingItem } from '../../types/flow-chat';
import { deriveTextBlockState, deriveThinkingBlockState } from '../../runtime/statusModel';
import { FlowTextBlock } from '../FlowTextBlock';
import { FlowToolCard } from '../FlowToolCard';
import { ModelThinkingDisplay } from '../../tool-cards/ModelThinkingDisplay';
import { isCollapsibleTool } from '../../tool-cards/collapsibleTools';
import { useFlowChatStaticContext } from './FlowChatContext';
import { FlowChatStore } from '../../store/FlowChatStore';
import { ExportImageButton } from './ExportImageButton';
import { ForkSessionButton } from './ForkSessionButton';
import { IconButton } from '@/design-system';
import { createLogger } from '@/shared/utils/logger';
import { useSessionProfile } from '@/app/session-profiles';
import { incrementFlowChatCounter } from '../../performance/flowChatPerf';
import './ModelRoundItem.scss';

const log = createLogger('ModelRoundItem');

interface ModelRoundItemProps {
  round: ModelRound;
  turnId: string;
  isLastRound?: boolean;
}

function hasActiveStreamingNarrative(items: FlowItem[]): boolean {
  return items.some(item => {
    if (item.type === 'text') return deriveTextBlockState(item as FlowTextItem) === 'streaming';
    if (item.type === 'thinking') return deriveThinkingBlockState(item as FlowThinkingItem) === 'streaming';
    return false;
  });
}

interface FlowItemRendererProps {
  item: FlowItem;
  turnId: string;
  roundId: string;
  isLastItem?: boolean;
}

const FlowItemRenderer: React.FC<FlowItemRendererProps> = React.memo(({ item, isLastItem }) => {
  const {
    onToolConfirm,
    onToolReject,
    onFileViewRequest,
    onTabOpen,
    sessionId,
  } = useFlowChatStaticContext();

  switch (item.type) {
    case 'text':
      return (
        <FlowTextBlock
          textItem={item as FlowTextItem}
        />
      );

    case 'thinking':
      return (
        <ModelThinkingDisplay thinkingItem={item as FlowThinkingItem} isLastItem={isLastItem} />
      );

    case 'tool':
      return (
        <div className="flowchat-flow-item" data-flow-item-id={item.id} data-flow-item-type="tool">
          <FlowToolCard
            toolItem={item as FlowToolItem}
            onConfirm={async (toolId: string, updatedInput?: any) => {
              if (onToolConfirm) {
                await onToolConfirm(toolId, updatedInput);
              }
            }}
            onReject={async () => {
              if (onToolReject) {
                await onToolReject(item.id);
              }
            }}
            onOpenInEditor={(filePath: string) => {
              if (onFileViewRequest) {
                onFileViewRequest(filePath, filePath.split(/[/\\]/).pop() || filePath);
              }
            }}
            onOpenInPanel={(_panelType: string, data: any) => {
              if (onTabOpen) {
                onTabOpen(data, sessionId);
              }
            }}
            sessionId={sessionId}
          />
        </div>
      );

    default:
      return null;
  }
}, (prev, next) => (
  prev.item === next.item &&
  prev.turnId === next.turnId &&
  prev.roundId === next.roundId &&
  prev.isLastItem === next.isLastItem
));
FlowItemRenderer.displayName = 'FlowItemRenderer';

export const ModelRoundItem = React.memo<ModelRoundItemProps>(
  ({ round, turnId, isLastRound = false }) => {
    incrementFlowChatCounter('render.modelRoundItem');
    const { t } = useTranslation('flow-chat');
    const { sessionId } = useFlowChatStaticContext();
    const [copied, setCopied] = useState(false);
    const copyButtonRef = useRef<HTMLButtonElement>(null);
    const { profile } = useSessionProfile();
    const showAgenticOsModelRoundUI = profile.capabilities.showAgenticOsModelRoundUI;
    
    useEffect(() => {
      if (!copied) return;
      
      const handleClickOutside = (event: MouseEvent) => {
        if (copyButtonRef.current && !copyButtonRef.current.contains(event.target as Node)) {
          setCopied(false);
        }
      };
      
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [copied]);
    
    const sortedItems = useMemo(
      () => round.items,
      [round.items]
    );
    
    type ItemGroup = 
      | { type: 'explore'; items: FlowItem[]; isLast: boolean }
      | { type: 'critical'; item: FlowItem };
    
    const groupedItems = useMemo(() => {
      const deferExploreGrouping = round.isStreaming && hasActiveStreamingNarrative(sortedItems);
      const finalGroups: ItemGroup[] = [];
      let exploreBuffer: FlowItem[] = [];
      let pendingBuffer: FlowItem[] = [];
      
      const flushExploreBuffer = (isLast: boolean) => {
        if (exploreBuffer.length > 0) {
          finalGroups.push({ type: 'explore', items: [...exploreBuffer], isLast });
          exploreBuffer = [];
        }
      };
      
      const flushPendingAsCritical = () => {
        for (const item of pendingBuffer) {
          finalGroups.push({ type: 'critical', item });
        }
        pendingBuffer = [];
      };
      
      for (let i = 0; i < sortedItems.length; i++) {
        const item = sortedItems[i];
        const isLastItem = i === sortedItems.length - 1;
        
        if (item.type === 'text' || item.type === 'thinking') {
          pendingBuffer.push(item);
          
          if (isLastItem) {
            flushExploreBuffer(false);
            flushPendingAsCritical();
          }
        } else if (item.type === 'tool') {
          const toolName = (item as FlowToolItem).toolName;
          const isExploreTool = isCollapsibleTool(toolName);

          if (isExploreTool) {
            if (deferExploreGrouping) {
              flushExploreBuffer(false);
              flushPendingAsCritical();
              finalGroups.push({ type: 'critical', item });
              continue;
            }
            exploreBuffer.push(...pendingBuffer, item);
            pendingBuffer = [];
            
            if (isLastItem) {
              flushExploreBuffer(true);
            }
          } else {
            flushExploreBuffer(false);
            flushPendingAsCritical();
            finalGroups.push({ type: 'critical', item });
          }
        }
      }
      
      flushExploreBuffer(true);
      flushPendingAsCritical();
      
      return finalGroups;
    }, [round.isStreaming, sortedItems]);

    const extractDialogTurnContent = useCallback(() => {
      const flowChatStore = FlowChatStore.getInstance();
      const state = flowChatStore.getState();
      
      let targetSession = null;
      for (const [, session] of state.sessions) {
        if (session.dialogTurns.some((turn: any) => turn.id === turnId)) {
          targetSession = session;
          break;
        }
      }
      
      if (!targetSession) return '';
      
      const dialogTurn = targetSession.dialogTurns.find((turn: any) => turn.id === turnId);
      if (!dialogTurn) return '';
      
      const contentParts: string[] = [];
      
      if (dialogTurn.userMessage?.content) {
        contentParts.push(`${t('modelRound.userLabel')}\n${dialogTurn.userMessage.content}`);
      }
      
      dialogTurn.modelRounds.forEach((modelRound: any) => {
        const roundContent: string[] = [];
        
        modelRound.items.forEach((item: any) => {
          if (item.type === 'text' && item.content?.trim()) {
            roundContent.push(item.content.trim());
          } else if (item.type === 'thinking' && item.content?.trim()) {
            roundContent.push(`[Thinking]\n${item.content.trim()}`);
          } else if (item.type === 'tool' && item.toolCall) {
            const toolName = item.toolName || t('copyOutput.unknownTool');
            let toolContent = t('modelRound.toolCallLabel', { name: toolName }) + '\n';
            
            if (item.toolCall.input) {
              const inputStr = typeof item.toolCall.input === 'string'
                ? item.toolCall.input
                : JSON.stringify(item.toolCall.input, null, 2);
              toolContent += `\n[Input]\n\`\`\`json\n${inputStr}\n\`\`\`\n`;
            }
            
            if (item.toolResult) {
              if (item.toolResult.error) {
                toolContent += `\n[Error]\n${item.toolResult.error}\n`;
              } else if (item.toolResult.result !== undefined) {
                const resultStr = typeof item.toolResult.result === 'string'
                  ? item.toolResult.result
                  : JSON.stringify(item.toolResult.result, null, 2);
                toolContent += `\n[Result]\n\`\`\`\n${resultStr}\n\`\`\`\n`;
              }
            }
            
            roundContent.push(toolContent.trim());
          }
        });
        
        if (roundContent.length > 0) {
          contentParts.push(roundContent.join('\n\n'));
        }
      });
      
      return contentParts.join('\n\n---\n\n');
    }, [t, turnId]);
    
    const handleCopy = useCallback(async () => {
      try {
        const content = extractDialogTurnContent();
        
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
    }, [extractDialogTurnContent]);
    
    const hasContent = sortedItems.some(item => 
      (item.type === 'text' && (item as FlowTextItem).content.trim()) ||
      (item.type === 'tool' && (item as FlowToolItem).toolCall)
    );
    
    return (
      <div 
        className={`model-round-item model-round-item--${round.isStreaming ? 'streaming' : 'complete'}`}
      >
        {groupedItems.map((group, groupIndex) => {
          const isLastGroup = groupIndex === groupedItems.length - 1;
          const isLast = isLastRound && isLastGroup;
          switch (group.type) {
            case 'explore':
              return group.items.map((item, itemIdx) => (
                <FlowItemRenderer 
                  key={item.id}
                  item={item}
                  turnId={turnId}
                  roundId={round.id}
                  isLastItem={isLast && itemIdx === group.items.length - 1}
                />
              ));
            
            case 'critical':
              return (
                <FlowItemRenderer 
                  key={group.item.id}
                  item={group.item}
                  turnId={turnId}
                  roundId={round.id}
                  isLastItem={isLast}
                />
              );
            
            default:
              return null;
          }
        })}
        
        {isLastRound && hasContent && !round.isStreaming && (
          <div className="model-round-item__footer">
            {!showAgenticOsModelRoundUI && (
              <ForkSessionButton sessionId={sessionId} turnId={turnId} />
            )}

            <IconButton
              ref={copyButtonRef}
              className={`model-round-item__action model-round-item__copy-action ${copied ? 'copied' : ''}`}
              onClick={handleCopy}
              tooltip={copied ? t('modelRound.copiedDialog') : t('modelRound.copyDialog')}
              tooltipPlacement="top"
              aria-label={copied ? t('modelRound.copiedDialog') : t('modelRound.copyDialog')}
              size="xs"
              variant="ghost"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
            
            <ExportImageButton turnId={turnId} />
          </div>
        )}
      </div>
    );
  },
  (prev, next) => {
    if (next.round.isStreaming || prev.round.isStreaming) {
      return false;
    }
    
    return (
      prev.round.id === next.round.id &&
      prev.round.items === next.round.items
    );
  }
);

ModelRoundItem.displayName = 'ModelRoundItem';
