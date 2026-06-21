import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { AgentAction } from '../../../reducers/agentReducer';
import {
  CLOSED_COMPOSER_COMMAND_INTERACTION,
  type ComposerCommandInteractionState,
} from '../model/composerState';

export function useComposerOutsideInteractions({
  agentBoostRef,
  containerRef,
  dispatchMode,
  dropdownOpen,
  slashCommandOpen,
  setCommandState,
  setSkillsFlyoutOpen,
}: {
  agentBoostRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  dispatchMode: Dispatch<AgentAction>;
  dropdownOpen: boolean;
  slashCommandOpen: boolean;
  setCommandState: Dispatch<SetStateAction<ComposerCommandInteractionState>>;
  setSkillsFlyoutOpen: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    const handlePointerOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const targetElement = target instanceof Element ? target : null;

      if (dropdownOpen && agentBoostRef.current && !agentBoostRef.current.contains(target)) {
        dispatchMode({ type: 'CLOSE_DROPDOWN' });
      }

      if (targetElement?.closest?.('.scroll-to-latest-bar')) return;

      if (!containerRef.current?.contains(target)) {
        dispatchMode({ type: 'CLOSE_DROPDOWN' });
        setSkillsFlyoutOpen(false);
        if (slashCommandOpen) {
          setCommandState(CLOSED_COMPOSER_COMMAND_INTERACTION);
        }
      }
    };

    document.addEventListener('mousedown', handlePointerOutside);
    return () => {
      document.removeEventListener('mousedown', handlePointerOutside);
    };
  }, [
    agentBoostRef,
    containerRef,
    dispatchMode,
    dropdownOpen,
    setCommandState,
    slashCommandOpen,
    setSkillsFlyoutOpen,
  ]);
}
