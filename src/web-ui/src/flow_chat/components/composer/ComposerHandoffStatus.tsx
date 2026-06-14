import React from 'react';
import { CircleAlert, MessageCircleQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DotMatrixLoader } from '@/design-system';
import type { ComposerOsHandoffState } from '../../domain/osHandoffIntent';

export interface ComposerHandoffStatusProps {
  state?: ComposerOsHandoffState | null;
}

export const ComposerHandoffStatus: React.FC<ComposerHandoffStatusProps> = ({ state }) => {
  const { t } = useTranslation('flow-chat');

  if (!state) {
    return null;
  }

  const modifier = state.status.replace(/_/g, '-');
  const icon = (() => {
    switch (state.status) {
      case 'deciding':
      case 'creating_work':
        return <DotMatrixLoader size="tiny" />;
      case 'needs_input':
        return <MessageCircleQuestion size={12} strokeWidth={2} />;
      case 'failed':
      case 'cancelled':
      default:
        return <CircleAlert size={12} strokeWidth={2} />;
    }
  })();

  return (
    <div
      className={`sparo-chat-input__handoff-status sparo-chat-input__handoff-status--${modifier}`}
      role="status"
      aria-live="polite"
    >
      <span className="sparo-chat-input__handoff-status-icon" aria-hidden>
        {icon}
      </span>
      <span className="sparo-chat-input__handoff-status-text">
        {t(`chatInput.osHandoff.${state.status}`)}
      </span>
    </div>
  );
};

ComposerHandoffStatus.displayName = 'ComposerHandoffStatus';
