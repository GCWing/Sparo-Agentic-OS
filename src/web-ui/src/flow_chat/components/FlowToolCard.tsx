/**
 * Streaming tool card component.
 * Renders a dedicated card based on tool type.
 */

import React from 'react';
import { getToolCardConfig, getToolCardComponent, getToolUiRegistryEntry } from '../tool-cards';
import type { FlowToolItem } from '../types/flow-chat';
import { createLogger } from '@/shared/utils/logger';
import { FlowToolCardErrorBoundary } from './FlowToolCardErrorBoundary';
import { useTranslation } from 'react-i18next';
import { getToolInterruptionNote } from '../utils/toolInterruption';
import { invalidateFlowLayout } from '../scroll/FlowLayoutMutationEvents';
import { ToolInterruptionNoteProvider } from '../tool-cards/ToolInterruptionNoteContext';

const log = createLogger('FlowToolCard');

interface FlowToolCardProps {
  toolItem: FlowToolItem;
  onConfirm?: (toolId: string, updatedInput?: any) => void;
  onReject?: (toolId: string) => void;
  onOpenInEditor?: (filePath: string) => void;
  onOpenInPanel?: (panelType: string, data: any) => void;
  onExpand?: (toolId: string) => void;
  sessionId?: string;
  className?: string;
}

function ToolCardLayoutInvalidation({ toolId, toolName }: { toolId: string; toolName: string }): null {
  React.useEffect(() => {
    invalidateFlowLayout({
      reason: 'tool-card-mounted',
      priority: 'high',
      source: toolName,
      toolId,
    });
  }, [toolId, toolName]);

  return null;
}

export const FlowToolCard: React.FC<FlowToolCardProps> = React.memo(({
  toolItem,
  onConfirm,
  onReject,
  onOpenInEditor,
  onOpenInPanel,
  onExpand,
  sessionId,
  className = '',
}) => {
  const { t } = useTranslation('flow-chat');
  const config = getToolCardConfig(toolItem.toolName);
  const CardComponent = getToolCardComponent(toolItem.toolName);
  const uiRegistryEntry = getToolUiRegistryEntry(toolItem.toolName);
  const interruptionNote = getToolInterruptionNote(toolItem, t);
  const sharedTemplateCanInlineInterruption =
    Boolean(interruptionNote) &&
    !config.inlineInterruptionNote &&
    uiRegistryEntry.template !== 'custom';
  const externalInterruptionNote =
    interruptionNote && !config.inlineInterruptionNote && !sharedTemplateCanInlineInterruption
      ? interruptionNote
      : null;

  const handleConfirm = React.useCallback((updatedInput?: any) => {
    log.debug('handleConfirm called', {
      toolId: toolItem.id,
      toolName: toolItem.toolName,
      hasUpdatedInput: updatedInput !== undefined,
      updatedInputKeys: updatedInput ? Object.keys(updatedInput) : []
    });
    onConfirm?.(toolItem.id, updatedInput);
  }, [toolItem.id, toolItem.toolName, onConfirm]);

  const handleReject = React.useCallback(() => {
    onReject?.(toolItem.id);
  }, [toolItem.id, onReject]);

  const handleExpand = React.useCallback(() => {
    onExpand?.(toolItem.id);
  }, [toolItem.id, onExpand]);

  React.useEffect(() => {
    invalidateFlowLayout({
      reason: 'tool-card-runtime-change',
      priority: 'normal',
      source: toolItem.toolName,
      toolId: toolItem.id,
    });
  }, [
    toolItem.id,
    toolItem.toolName,
    toolItem.runtime?.lifecycle,
    toolItem.runtime?.inputPhase,
    toolItem.status,
    toolItem.toolResult,
    toolItem.terminalSessionId,
  ]);

  return (
    <div className={`flow-tool-card-wrapper ${className}`}>
      <FlowToolCardErrorBoundary
        toolItem={toolItem}
        displayName={config.displayName}
        sessionId={sessionId}
      >
        <React.Suspense fallback={null}>
          <ToolCardLayoutInvalidation toolId={toolItem.id} toolName={toolItem.toolName} />
          <ToolInterruptionNoteProvider value={sharedTemplateCanInlineInterruption ? interruptionNote : null}>
            <CardComponent
              toolItem={toolItem}
              config={config}
              onConfirm={handleConfirm}
              onReject={handleReject}
              onOpenInEditor={onOpenInEditor}
              onOpenInPanel={onOpenInPanel}
              onExpand={handleExpand}
              sessionId={sessionId}
              interruptionNote={interruptionNote}
            />
          </ToolInterruptionNoteProvider>
        </React.Suspense>
      </FlowToolCardErrorBoundary>
      {externalInterruptionNote && (
        <div className="flow-tool-card-note flow-tool-card-note--interrupted" role="note">
          {externalInterruptionNote}
        </div>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Compare runtime parameters and progress messages to avoid stale renders.
  const prevProgress = (prevProps.toolItem as any)._progressMessage;
  const nextProgress = (nextProps.toolItem as any)._progressMessage;
  const prevParamsBuffer = (prevProps.toolItem as any)._paramsBuffer;
  const nextParamsBuffer = (nextProps.toolItem as any)._paramsBuffer;
  
  return (
    prevProps.toolItem.id === nextProps.toolItem.id &&
    prevProps.toolItem.toolName === nextProps.toolItem.toolName &&
    prevProps.toolItem.interruptionReason === nextProps.toolItem.interruptionReason &&
    prevProps.toolItem.terminalSessionId === nextProps.toolItem.terminalSessionId &&
    prevProps.toolItem.userConfirmed === nextProps.toolItem.userConfirmed &&
    prevProps.toolItem.runtime === nextProps.toolItem.runtime &&
    prevProgress === nextProgress &&
    prevParamsBuffer === nextParamsBuffer &&
    prevProps.toolItem.toolResult === nextProps.toolItem.toolResult
  );
});
