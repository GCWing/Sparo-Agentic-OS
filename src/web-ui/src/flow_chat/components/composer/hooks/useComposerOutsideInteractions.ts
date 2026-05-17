import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { ModeAction } from '../../../reducers/modeReducer';

export function useComposerOutsideInteractions({
  agentBoostRef,
  canCollapseToSingleLineInput,
  containerRef,
  dispatchMode,
  dropdownOpen,
  setIsInputMultiline,
  setSkillsFlyoutOpen,
}: {
  agentBoostRef: RefObject<HTMLDivElement | null>;
  canCollapseToSingleLineInput: () => boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  dispatchMode: Dispatch<ModeAction>;
  dropdownOpen: boolean;
  setIsInputMultiline: Dispatch<SetStateAction<boolean>>;
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

        if (canCollapseToSingleLineInput()) {
          setIsInputMultiline(false);
        }
      }
    };

    document.addEventListener('mousedown', handlePointerOutside);
    return () => {
      document.removeEventListener('mousedown', handlePointerOutside);
    };
  }, [
    agentBoostRef,
    canCollapseToSingleLineInput,
    containerRef,
    dispatchMode,
    dropdownOpen,
    setIsInputMultiline,
    setSkillsFlyoutOpen,
  ]);
}
