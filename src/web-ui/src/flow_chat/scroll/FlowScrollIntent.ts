export const TOUCH_SCROLL_INTENT_EXIT_THRESHOLD_PX = 6;

export function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}

export function isUpwardScrollIntentKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }

  return (
    event.key === 'ArrowUp' ||
    event.key === 'PageUp' ||
    event.key === 'Home' ||
    (event.key === ' ' && event.shiftKey)
  );
}

export function isDownwardScrollIntentKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }

  return (
    event.key === 'ArrowDown' ||
    event.key === 'PageDown' ||
    event.key === 'End' ||
    (event.key === ' ' && !event.shiftKey)
  );
}

export function isPointerOnScrollbarGutter(
  scroller: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const rect = scroller.getBoundingClientRect();
  const verticalScrollbarWidth = Math.max(0, scroller.offsetWidth - scroller.clientWidth);
  const horizontalScrollbarHeight = Math.max(0, scroller.offsetHeight - scroller.clientHeight);

  const isWithinVerticalScrollbar = (
    verticalScrollbarWidth > 0 &&
    clientX >= rect.right - verticalScrollbarWidth &&
    clientX <= rect.right &&
    clientY >= rect.top &&
    clientY <= rect.bottom
  );

  const isWithinHorizontalScrollbar = (
    horizontalScrollbarHeight > 0 &&
    clientY >= rect.bottom - horizontalScrollbarHeight &&
    clientY <= rect.bottom &&
    clientX >= rect.left &&
    clientX <= rect.right
  );

  return isWithinVerticalScrollbar || isWithinHorizontalScrollbar;
}
