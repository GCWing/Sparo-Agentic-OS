import { useCallback } from 'react';
import type { Dispatch, RefObject } from 'react';
import type { TFunction } from 'i18next';
import { notificationService } from '@/shared/notification-system';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import { PromptLibraryAPI, type PromptAssetSummary } from '@/infrastructure/api/service-api/PromptLibraryAPI';
import type { InputAction } from '../../../reducers/inputReducer';
import type { AgentAction } from '../../../reducers/agentReducer';
import type { RichTextInputHandle } from '../../RichTextInput';

export function useComposerBoostActions({
  currentSessionId,
  dismissSkillsFlyout,
  dispatchInput,
  dispatchMode,
  focusInputSoon,
  handleImageInput,
  inputValue,
  isBtwSession,
  richTextInputRef,
  selectSlashCommandAction,
  workspacePath,
  t,
}: {
  currentSessionId?: string | null;
  dismissSkillsFlyout: () => void;
  dispatchInput: Dispatch<InputAction>;
  dispatchMode: Dispatch<AgentAction>;
  focusInputSoon: () => void;
  handleImageInput: () => void;
  inputValue: string;
  isBtwSession: boolean;
  richTextInputRef: RefObject<RichTextInputHandle | null>;
  selectSlashCommandAction: (actionId: string) => void;
  workspacePath?: string | null;
  t: TFunction<'flow-chat'>;
}) {
  const insertSkillIntoInput = useCallback(
    (skillName: string) => {
      const line = t('chatInput.insertSkillLine', { name: skillName });
      dispatchInput({ type: 'ACTIVATE' });
      const next = inputValue.trim() ? `${inputValue.trimEnd()}\n\n${line}` : line;
      dispatchInput({ type: 'SET_VALUE', payload: next });
      dismissSkillsFlyout();
      dispatchMode({ type: 'CLOSE_DROPDOWN' });
      focusInputSoon();
    },
    [dismissSkillsFlyout, dispatchInput, dispatchMode, focusInputSoon, inputValue, t],
  );

  const insertPromptIntoInput = useCallback(
    async (asset: PromptAssetSummary) => {
      try {
        const fullAsset = await PromptLibraryAPI.getPromptAsset(
          workspacePath || '',
          asset.id,
          asset.scope,
        );
        dispatchInput({ type: 'ACTIVATE' });
        const next = inputValue.trim()
          ? `${inputValue.trimEnd()}\n\n${fullAsset.body}`
          : fullAsset.body;
        dispatchInput({ type: 'SET_VALUE', payload: next });
        dismissSkillsFlyout();
        dispatchMode({ type: 'CLOSE_DROPDOWN' });
        focusInputSoon();
      } catch {
        notificationService.error(
          t('chatInput.promptInsertFailed', { defaultValue: 'Failed to insert prompt asset' }),
        );
      }
    },
    [workspacePath, inputValue, dispatchInput, dismissSkillsFlyout, dispatchMode, focusInputSoon, t],
  );

  const handleBoostPickImage = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      dispatchMode({ type: 'CLOSE_DROPDOWN' });
      handleImageInput();
    },
    [dispatchMode, handleImageInput],
  );

  const handleBoostOpenAtContext = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    dispatchMode({ type: 'CLOSE_DROPDOWN' });
    dispatchInput({ type: 'ACTIVATE' });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        richTextInputRef.current?.openMention();
      });
    });
  }, [dispatchInput, dispatchMode, richTextInputRef]);

  const handleOpenSkillsLibrary = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      dismissSkillsFlyout();
      dispatchMode({ type: 'CLOSE_DROPDOWN' });
      openWorkspaceScene('skills' as WorkspaceSceneId);
    },
    [dismissSkillsFlyout, dispatchMode],
  );

  const handleOpenPromptLibrary = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      dismissSkillsFlyout();
      dispatchMode({ type: 'CLOSE_DROPDOWN' });
      openWorkspaceScene('prompt-library' as WorkspaceSceneId);
    },
    [dismissSkillsFlyout, dispatchMode],
  );

  const handleBoostStartBtw = useCallback(
    (event: React.SyntheticEvent) => {
      event.stopPropagation();
      if (!currentSessionId) {
        notificationService.error(t('btw.noSession', { defaultValue: 'No active session for /btw' }));
        return;
      }
      if (isBtwSession) {
        notificationService.warning(
          t('btw.nestedDisabled', { defaultValue: 'Side questions cannot create another side question' }),
        );
        return;
      }
      selectSlashCommandAction('btw');
      dispatchMode({ type: 'CLOSE_DROPDOWN' });
    },
    [currentSessionId, dispatchMode, isBtwSession, selectSlashCommandAction, t],
  );

  return {
    handleBoostOpenAtContext,
    handleBoostPickImage,
    handleBoostStartBtw,
    handleOpenPromptLibrary,
    handleOpenSkillsLibrary,
    insertPromptIntoInput,
    insertSkillIntoInput,
  };
}
