/**
 * FlowChat scroll layout: floating ChatInput + message list footer / scroll-to-latest.
 * Keep footer spacer and overlay controls aligned on the same geometric model.
 */

/** Matches `.sparo-chat-input-drop-zone { bottom: �?}` */
export const CHAT_INPUT_DROP_ZONE_BOTTOM_PX = 8;

/** Space between the top edge of the input block and the end of scroll content */
export const FLOWCHAT_MESSAGE_TAIL_CLEARANCE_PX = 8;

/** Space above the scroll-to-latest control (tighter than message tail; sits in overlay) */
export const SCROLL_TO_LATEST_INPUT_CLEARANCE_PX = 6;

const FALLBACK_INPUT_BLOCK_ACTIVE_PX = 96;
const FALLBACK_INPUT_BLOCK_COLLAPSED_PX = 54;

/**
 * Height of the Virtuoso footer spacer needed so the last message clears the floating input.
 * `measuredInputHeight` is the drop-zone `offsetHeight` from ChatInput (excluding the 16px viewport inset).
 */
export function computeFlowChatInputStackFooterPx(
  measuredInputHeight: number,
  isInputActive: boolean,
): number {
  const inputBlock =
    measuredInputHeight > 0
      ? measuredInputHeight
      : isInputActive
        ? FALLBACK_INPUT_BLOCK_ACTIVE_PX
        : FALLBACK_INPUT_BLOCK_COLLAPSED_PX;
  return inputBlock + CHAT_INPUT_DROP_ZONE_BOTTOM_PX + FLOWCHAT_MESSAGE_TAIL_CLEARANCE_PX;
}
