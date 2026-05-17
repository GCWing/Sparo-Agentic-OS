import { useCallback } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { FlowChatStore } from '../../../store/FlowChatStore';
import type { InputAction } from '../../../reducers/inputReducer';
import type { ModeAction, ModeInfo } from '../../../reducers/modeReducer';
import type { RichTextInputHandle } from '../../RichTextInput';
import type { SlashMcpPromptItem } from '../model/composerCommands';
import type { ComposerSlashCommandState } from '../model/composerState';

const closedSlashState: ComposerSlashCommandState = {
  isActive: false,
  kind: 'modes',
  query: '',
  selectedIndex: 0,
};

export function useComposerModeActions({
  canSwitchModes,
  currentMode,
  dispatchInput,
  dispatchMode,
  effectiveTargetSessionId,
  inputValue,
  isBtwSession,
  richTextInputRef,
  setQueuedInput,
  setSlashCommandState,
  switchableModes,
}: {
  canSwitchModes: boolean;
  currentMode: string;
  dispatchInput: Dispatch<InputAction>;
  dispatchMode: Dispatch<ModeAction>;
  effectiveTargetSessionId?: string | null;
  inputValue: string;
  isBtwSession: boolean;
  richTextInputRef: RefObject<RichTextInputHandle | null>;
  setQueuedInput: (value: string | null) => void;
  setSlashCommandState: Dispatch<SetStateAction<ComposerSlashCommandState>>;
  switchableModes: ModeInfo[];
}) {
  const applyModeChange = useCallback((modeId: string) => {
    dispatchMode({
      type: 'SET_CURRENT_MODE',
      payload: modeId,
    });

    try {
      sessionStorage.setItem('sparo:flowchat:lastMode', modeId);
    } catch {
      // ignore
    }

    if (effectiveTargetSessionId) {
      FlowChatStore.getInstance().updateSessionMode(effectiveTargetSessionId, modeId);
    }
  }, [dispatchMode, effectiveTargetSessionId]);

  const requestModeChange = useCallback((modeId: string) => {
    if (!canSwitchModes || modeId === currentMode || !switchableModes.some(mode => mode.id === modeId)) {
      dispatchMode({ type: 'CLOSE_DROPDOWN' });
      return;
    }

    applyModeChange(modeId);
    dispatchMode({ type: 'CLOSE_DROPDOWN' });
  }, [applyModeChange, canSwitchModes, currentMode, dispatchMode, switchableModes]);

  const selectSlashCommandMode = useCallback((modeId: string) => {
    requestModeChange(modeId);
    dispatchInput({ type: 'CLEAR_VALUE' });
    setSlashCommandState(closedSlashState);
  }, [dispatchInput, requestModeChange, setSlashCommandState]);

  const selectSlashCommandAction = useCallback((actionId: string) => {
    const raw = inputValue || '';
    const lower = raw.trimStart().toLowerCase();
    let next = raw;

    if (actionId === 'btw') {
      if (isBtwSession) {
        return;
      }
      if (!lower.startsWith('/btw')) {
        next = '/btw ';
      } else {
        const match = raw.match(/^(\s*)\/btw\b/i);
        if (match) {
          const leadingWs = match[1] || '';
          const rest = raw.slice(match[0].length);
          next = `${leadingWs}/btw ${rest.trimStart()}`;
        } else {
          next = '/btw ';
        }
      }
    } else if (actionId === 'compact') {
      next = '/compact';
    } else if (actionId === 'init') {
      next = '/init';
    } else if (actionId === 'scan_host') {
      next = '/scan_host';
    } else {
      return;
    }

    dispatchInput({ type: 'SET_VALUE', payload: next });
    setQueuedInput(null);
    setSlashCommandState(closedSlashState);
    window.setTimeout(() => richTextInputRef.current?.focus(), 0);
  }, [
    dispatchInput,
    inputValue,
    isBtwSession,
    richTextInputRef,
    setQueuedInput,
    setSlashCommandState,
  ]);

  const selectSlashPromptCommand = useCallback((item: SlashMcpPromptItem) => {
    const hasArguments = item.arguments.length > 0;
    dispatchInput({
      type: 'SET_VALUE',
      payload: hasArguments ? `${item.command} ` : item.command,
    });
    setQueuedInput(null);
    setSlashCommandState(closedSlashState);
    window.setTimeout(() => richTextInputRef.current?.focus(), 0);
  }, [dispatchInput, richTextInputRef, setQueuedInput, setSlashCommandState]);

  return {
    applyModeChange,
    requestModeChange,
    selectSlashCommandAction,
    selectSlashCommandMode,
    selectSlashPromptCommand,
  };
}
