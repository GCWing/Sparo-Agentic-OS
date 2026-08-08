import { useCallback } from 'react';
import type { Dispatch, RefObject } from 'react';
import type { TFunction } from 'i18next';
import { notificationService } from '@/shared/notification-system';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import type { WorkspaceSceneId } from '@/app/navigation/workspaceSceneTypes';
import type { InputAction } from '../../../reducers/inputReducer';
import type { AgentAction } from '../../../reducers/agentReducer';
import type { RichTextInputHandle } from '../../RichTextInput';
import type { ContextItem, SkillSelectionContext } from '@/shared/types/context';
import type { AttachmentReferenceResolution } from '@/shared/stores/contextStore';
import type { SkillSelectionTarget } from '@/shared/skillLibrary';

export function useComposerBoostActions({
  currentSessionId,
  dismissSkillsFlyout,
  dispatchInput,
  dispatchMode,
  contexts,
  resolveAttachmentReference,
  removeAttachment,
  focusInputSoon,
  handleImageInput,
  isBtwSession,
  onStartSideQuestionDraft,
  richTextInputRef,
  t,
}: {
  currentSessionId?: string | null;
  dismissSkillsFlyout: () => void;
  dispatchInput: Dispatch<InputAction>;
  dispatchMode: Dispatch<AgentAction>;
  contexts: ContextItem[];
  resolveAttachmentReference: (context: ContextItem) => AttachmentReferenceResolution;
  removeAttachment: (assetId: string) => void;
  focusInputSoon: () => void;
  handleImageInput: () => void;
  isBtwSession: boolean;
  onStartSideQuestionDraft: () => void;
  richTextInputRef: RefObject<RichTextInputHandle | null>;
  t: TFunction<'flow-chat'>;
}) {
  const insertSkillIntoInput = useCallback(
    (target: SkillSelectionTarget) => {
      const selectedSkills = contexts.filter(
        (context): context is SkillSelectionContext => context.type === 'skill-selection',
      );
      if (selectedSkills.some(context => context.command === target.command)) {
        dismissSkillsFlyout();
        dispatchMode({ type: 'CLOSE_DROPDOWN' });
        focusInputSoon();
        return;
      }

      selectedSkills.forEach(context => {
        const sameSuite = Boolean(target.suiteId) && context.suiteId === target.suiteId;
        if (!sameSuite) return;
        if (target.kind === 'suite' || context.targetKind === 'suite') {
          removeAttachment(context.id);
        }
      });

      const context: SkillSelectionContext = {
        id: `skill-selection:${target.kind}:${target.key}`,
        type: 'skill-selection',
        timestamp: Date.now(),
        targetKind: target.kind,
        targetKey: target.key,
        command: target.command,
        name: target.name,
        description: target.description,
        suiteId: target.suiteId,
        suiteName: target.suiteName,
        memberCount: target.memberCount,
      };

      dispatchInput({ type: 'ACTIVATE' });
      const resolution = resolveAttachmentReference(context);
      if (resolution.kind === 'rejected') return;
      richTextInputRef.current?.insertTag(resolution.reference, resolution.asset);
      dismissSkillsFlyout();
      dispatchMode({ type: 'CLOSE_DROPDOWN' });
      focusInputSoon();
    },
    [
      contexts,
      dismissSkillsFlyout,
      dispatchInput,
      dispatchMode,
      focusInputSoon,
      removeAttachment,
      resolveAttachmentReference,
      richTextInputRef,
    ],
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
      onStartSideQuestionDraft();
      dispatchInput({ type: 'ACTIVATE' });
      dispatchMode({ type: 'CLOSE_DROPDOWN' });
      focusInputSoon();
    },
    [currentSessionId, dispatchInput, dispatchMode, focusInputSoon, isBtwSession, onStartSideQuestionDraft, t],
  );

  return {
    handleBoostOpenAtContext,
    handleBoostPickImage,
    handleBoostStartBtw,
    handleOpenSkillsLibrary,
    insertSkillIntoInput,
  };
}
