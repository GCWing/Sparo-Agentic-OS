import { useCallback } from 'react';
import { ContentCanvas } from '../../components/panels/content-canvas';
import { useAuxiliarySurfaceStore } from '@/app/auxiliary-surface';
import { createLogger } from '@/shared/utils/logger';
import './AuxPane.scss';

const log = createLogger('AuxPane');

interface AuxPaneProps {
  workspacePath?: string;
  isSceneActive?: boolean;
}

/**
 * Pure presentation adapter for the active auxiliary host.
 * Host activation and tab ownership are handled by workspace navigation.
 */
export default function AuxPane({
  workspacePath,
  isSceneActive = true,
}: AuxPaneProps) {
  const activeHostKey = useAuxiliarySurfaceStore(state => state.activeHostKey);
  const collapse = useAuxiliarySurfaceStore(state => state.collapse);

  const handleInteraction = useCallback(async (itemId: string, userInput: string) => {
    log.debug('Panel interaction', { itemId, userInput });
  }, []);

  const handleRequestClose = useCallback(() => {
    if (activeHostKey) collapse(activeHostKey, 'user');
  }, [activeHostKey, collapse]);

  return (
    <div className="sparo-aux-pane">
      <ContentCanvas
        workspacePath={workspacePath}
        mode="agent"
        isSceneActive={isSceneActive}
        onInteraction={handleInteraction}
        onRequestClose={handleRequestClose}
      />
    </div>
  );
}
