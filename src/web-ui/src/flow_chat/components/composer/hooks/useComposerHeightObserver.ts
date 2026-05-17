import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useChatInputState } from '../../../store/chatInputStateStore';

export function useComposerHeightObserver(
  containerRef: RefObject<HTMLDivElement | null>,
) {
  const setChatInputHeight = useChatInputState(state => state.setInputHeight);

  useEffect(() => {
    const dropZone = containerRef.current?.closest('.sparo-chat-input-drop-zone') as HTMLElement | null;
    const el = dropZone ?? containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      setChatInputHeight(el.offsetHeight);
    });

    observer.observe(el);
    setChatInputHeight(el.offsetHeight);

    return () => observer.disconnect();
  }, [containerRef, setChatInputHeight]);
}
