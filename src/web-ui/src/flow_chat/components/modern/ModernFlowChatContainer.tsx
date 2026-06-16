/**
 * Modern FlowChat container �?router.
 *
 * Selects the appropriate container based on session profile:
 *   - agentic-os -> AgenticOSFlowChatContainer
 *   - everything else �?StandardFlowChatContainer
 *
 * Both containers evolve independently; logic shared between them lives in
 * useFlowChatCore.ts.
 */

import React from 'react';
import { useSessionProfile } from '@/app/session-profiles';
import { AgenticOSFlowChatContainer } from './AgenticOSFlowChatContainer';
import { StandardFlowChatContainer } from './StandardFlowChatContainer';
import type { LineRange } from '@/shared/markdown';
import type { FlowChatConfig } from '../../types/flow-chat';

interface ModernFlowChatContainerProps {
  className?: string;
  config?: Partial<FlowChatConfig>;
  onFileViewRequest?: (filePath: string, fileName: string, lineRange?: LineRange) => void;
  onTabOpen?: (tabInfo: any, sessionId?: string, panelType?: string) => void;
  onOpenVisualization?: (type: string, data: any) => void;
  onSwitchToChatPanel?: () => void;
}

export const ModernFlowChatContainer: React.FC<ModernFlowChatContainerProps> = (props) => {
  const { profile } = useSessionProfile();

  if (profile.id === 'agentic-os') {
    return <AgenticOSFlowChatContainer {...props} />;
  }

  return <StandardFlowChatContainer {...props} />;
};

ModernFlowChatContainer.displayName = 'ModernFlowChatContainer';
