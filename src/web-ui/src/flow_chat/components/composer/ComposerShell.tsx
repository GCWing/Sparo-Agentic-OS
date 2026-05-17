import type React from 'react';
import { ContextDropZone } from '../../../shared/context-system';
import type { ContextItem } from '../../../shared/types/context';
import { SmartRecommendations } from '../smart-recommendations';

interface RecommendationContext {
  workspacePath?: string;
  sessionId?: string;
  turnIndex?: number;
  modifiedFiles?: string[];
}

interface ComposerShellProps {
  containerRef: React.Ref<HTMLDivElement>;
  className?: string;
  isActive: boolean;
  isExpanded: boolean;
  isStacked: boolean;
  isTargeting: boolean;
  isProcessing: boolean;
  recommendationContext: RecommendationContext | null;
  targetSwitcher: React.ReactNode;
  editorArea: React.ReactNode;
  actions: React.ReactNode;
  onActivate?: (event: React.MouseEvent) => void;
  onContextAdded: (context: ContextItem) => void;
}

export function ComposerShell({
  containerRef,
  className = '',
  isActive,
  isExpanded,
  isStacked,
  isTargeting,
  isProcessing,
  recommendationContext,
  targetSwitcher,
  editorArea,
  actions,
  onActivate,
  onContextAdded,
}: ComposerShellProps) {
  return (
    <ContextDropZone
      acceptedTypes={['file', 'directory', 'image', 'code-snippet']}
      className="sparo-chat-input-drop-zone"
      onContextAdded={onContextAdded}
    >
      <div
        ref={containerRef}
        className={`sparo-chat-input ${isActive ? 'sparo-chat-input--active' : 'sparo-chat-input--collapsed'} ${isExpanded ? 'sparo-chat-input--expanded' : ''} ${isStacked ? 'sparo-chat-input--multiline' : ''} ${isTargeting ? 'sparo-chat-input--targeting' : ''} ${isProcessing ? 'sparo-chat-input--processing' : ''} ${className}`}
        onClick={!isActive ? onActivate : undefined}
        data-testid="chat-input-container"
      >
        {recommendationContext && (
          <SmartRecommendations
            context={recommendationContext}
            className="sparo-chat-input__recommendations"
          />
        )}

        <div className="sparo-chat-input__container">
          <div className={`sparo-chat-input__box ${isExpanded ? 'sparo-chat-input__box--expanded' : ''}`}>
            {targetSwitcher}
            {editorArea}
            {actions}
          </div>
        </div>
      </div>
    </ContextDropZone>
  );
}
