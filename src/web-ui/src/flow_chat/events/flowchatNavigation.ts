/**
 * Shared navigation events for FlowChat viewport movement and focus.
 */

export const FLOWCHAT_FOCUS_ITEM_EVENT = 'flowchat:focus-item';

export type FlowChatFocusItemSource = 'btw-back';

export interface FlowChatFocusItemRequest {
  sessionId: string;
  turnIndex?: number;
  itemId?: string;
  source?: FlowChatFocusItemSource;
}
