import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { IconButton, Tooltip } from '@/design-system';
import { useFlowChatStoreSelector } from '../hooks/useFlowChatStoreSelector';
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
  const titleValue = useFlowChatStoreSelector((state) => {
    const activeSession = state.activeSessionId
      ? state.sessions.get(state.activeSessionId)
      : undefined;
    return {
      hasSession: Boolean(activeSession),
      title: activeSession?.title,
    };
  }, (left, right) => left.hasSession === right.hasSession && left.title === right.title);

  const title = !titleValue.hasSession
    ? t('session.noSession')
    : titleValue.title || t('session.new');

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
