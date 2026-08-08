import { useCallback } from 'react';
import { ContentCanvas } from '../../components/panels/content-canvas';
import { useAuxiliarySurfaceStore } from '@/app/auxiliary-surface';
import { createLogger } from '@/shared/utils/logger';
import './AuxPane.scss';

const log = createLogger('AuxPane');

interface AuxPaneProps {
  workspacePath?: string;
  isSceneActive?: boolean;
  isSceneFocused?: boolean;
}

/**
 * Pure presentation adapter for the active auxiliary host.
 * Host activation and tab ownership are handled by workspace navigation.
 */
export default function AuxPane({
  workspacePath,
  isSceneActive = true,
  isSceneFocused = false,
}: AuxPaneProps) {
  const activeHostKey = useAuxiliarySurfaceStore(state => state.activeHostKey);
  const collapse = useAuxiliarySurfaceStore(state => state.collapse);

  const handleInteraction = useCallback(async (itemId: string, userInput: string) => {
    log.debug('Panel interaction', { itemId, userInput });
  }, []);

  const restoreToggleFocus = useCallback(() => {
    document.querySelector<HTMLElement>(
      '[data-testid="flowchat-header-right-panel-toggle"]',
    )?.focus();
  }, []);

  const handleRequestClose = useCallback(() => {
    if (!activeHostKey) return;
    restoreToggleFocus();
    collapse(activeHostKey, 'user');
  }, [activeHostKey, collapse, restoreToggleFocus]);

  const handleLastVisibleTabClosed = useCallback(() => {
    if (!activeHostKey) return;
    restoreToggleFocus();
    collapse(activeHostKey, 'empty');
  }, [activeHostKey, collapse, restoreToggleFocus]);

  return (
    <div className="sparo-aux-pane">
      <ContentCanvas
        workspacePath={workspacePath}
        mode="agent"
        isSceneActive={isSceneActive}
        isSceneFocused={isSceneFocused}
        onInteraction={handleInteraction}
        disablePopOut={isSceneFocused}
        onRequestClose={isSceneFocused ? undefined : handleRequestClose}
        onLastVisibleTabClosed={handleLastVisibleTabClosed}
      />
    </div>
  );
}
