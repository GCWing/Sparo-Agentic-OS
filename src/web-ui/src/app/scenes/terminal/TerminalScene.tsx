/**
 * TerminalScene �?renders a ConnectedTerminal for the session selected
 * via terminalSceneStore (set from ShellNav in ShellScene or agent tabs).
 *
 * When no session is active, shows a minimal empty state prompting the
 * user to pick or create a terminal from the shell list.
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SquareTerminal } from 'lucide-react';
import { useTerminalSceneStore } from '../../stores/terminalSceneStore';
import ConnectedTerminal from '../../../tools/terminal/components/ConnectedTerminal';
import './TerminalScene.scss';

interface TerminalSceneProps {
  isActive?: boolean;
}

const TerminalScene: React.FC<TerminalSceneProps> = ({ isActive = true }) => {
  const { activeSessionId, setActiveSession } = useTerminalSceneStore();
  const { t } = useTranslation('panels/terminal');

  const handleExit = useCallback(() => {
    setActiveSession(null);
  }, [setActiveSession]);

  const handleClose = useCallback(() => {
    setActiveSession(null);
  }, [setActiveSession]);

  if (!isActive) {
    return <div className="sparo-terminal-scene" aria-hidden="true" />;
  }

  return (
    <div className="sparo-terminal-scene">
      {activeSessionId ? (
        <ConnectedTerminal
          key={activeSessionId}
          sessionId={activeSessionId}
          autoFocus
          showToolbar
          showStatusBar
          onExit={handleExit}
          onClose={handleClose}
        />
      ) : (
        <div className="sparo-terminal-scene__empty">
          <SquareTerminal size={32} className="sparo-terminal-scene__empty-icon" />
          <p className="sparo-terminal-scene__empty-hint">{t('emptyState')}</p>
        </div>
      )}
    </div>
  );
};

export default TerminalScene;
