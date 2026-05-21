import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { AgentAction } from '../../../reducers/agentReducer';
import type { ComposerSlashCommandState } from '../model/composerState';

const closedSlashState: ComposerSlashCommandState = {
  isActive: false,
  kind: 'agents',
  query: '',
  selectedIndex: 0,
};

export function useComposerOutsideInteractions({
  agentBoostRef,
  containerRef,
  dispatchMode,
  dropdownOpen,
  slashCommandOpen,
  setSkillsFlyoutOpen,
  setSlashCommandState,
}: {
  agentBoostRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  dispatchMode: Dispatch<AgentAction>;
  dropdownOpen: boolean;
  slashCommandOpen: boolean;
  setSkillsFlyoutOpen: Dispatch<SetStateAction<boolean>>;
  setSlashCommandState: Dispatch<SetStateAction<ComposerSlashCommandState>>;
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
          setSlashCommandState(closedSlashState);
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
    slashCommandOpen,
    setSkillsFlyoutOpen,
    setSlashCommandState,
  ]);
}
