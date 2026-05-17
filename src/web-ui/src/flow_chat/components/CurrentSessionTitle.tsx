import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { flowChatStore } from '../store/FlowChatStore';
import { FlowChatState, Session } from '../types/flow-chat';
import { IconButton, Tooltip } from '@/design-system';
import './CurrentSessionTitle.scss';

interface CurrentSessionTitleProps {
  onCreateSession?: () => void;
}

/**
 * Current session title component.
 * Renders the active session name in the header.
 */
const CurrentSessionTitle: React.FC<CurrentSessionTitleProps> = ({ onCreateSession }) => {
  const { t } = useTranslation('flow-chat');
  const [flowChatState, setFlowChatState] = useState<FlowChatState>(() => 
    flowChatStore.getState()
  );
  // Subscribe to FlowChatStore updates to keep the title in sync.
  useEffect(() => {
    const unsubscribe = flowChatStore.subscribe((state) => {
      setFlowChatState(state);
    });
    return () => unsubscribe();
  }, []);

  const activeSession: Session | undefined = flowChatState.activeSessionId 
    ? flowChatState.sessions.get(flowChatState.activeSessionId)
    : undefined;

  const getSessionTitle = (session: Session | undefined): string => {
    if (!session) {
      return t('session.noSession');
    }
    return session.title || t('session.new');
  };

  const title = getSessionTitle(activeSession);

  const handleCreateSession = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCreateSession) {
      onCreateSession();
    }
  };

  const newSessionLabel = t('session.newCode');

  return (
    <div className="sparo-current-session-title">
      <span className="sparo-current-session-title__text">{title}</span>
      <Tooltip content={newSessionLabel} placement="bottom">
        <IconButton
          className="sparo-current-session-title__create-action"
          onClick={handleCreateSession}
          aria-label={newSessionLabel}
          size="small"
          variant="ghost"
        >
          <Plus size={16} />
        </IconButton>
      </Tooltip>
    </div>
  );
};

export default CurrentSessionTitle;
export { CurrentSessionTitle };
