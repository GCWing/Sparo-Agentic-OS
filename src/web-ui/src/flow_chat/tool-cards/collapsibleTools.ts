import type { FlowItem, FlowToolItem } from '../types/flow-chat';

/**
 * Collapsible explorer tools.
 * They are auto-collapsed during streaming to reduce visual noise.
 */
export const COLLAPSIBLE_TOOL_NAMES = new Set([
  'Read',
  'LS',
  'Grep',
  'Glob',
  'WebSearch',
  'Bash',
]);

/** Read tools (counted in readCount). */
export const READ_TOOL_NAMES = new Set(['Read', 'LS']);

/** Search tools (counted in searchCount). */
export const SEARCH_TOOL_NAMES = new Set(['Grep', 'Glob', 'WebSearch']);

/** Command tools (counted in commandCount). */
export const COMMAND_TOOL_NAMES = new Set(['Bash']);

/** Check whether a tool is collapsible. */
export function isCollapsibleTool(toolName: string): boolean {
  return COLLAPSIBLE_TOOL_NAMES.has(toolName);
}

/**
 * Check whether a FlowItem is collapsible (no context).
 * - Text needs context (use isCollapsibleItemWithContext).
 * - Thinking can be collapsed with explorer tools.
 * - Only explorer tools are collapsible.
 */
export function isCollapsibleItem(item: FlowItem): boolean {
  // Text: default not collapsed (needs isCollapsibleItemWithContext).
  if (item.type === 'text') return false;

  // Thinking can be collapsed with explorer tools.
  if (item.type === 'thinking') return true;

  // Tools: only explorer tools are collapsible.
  if (item.type === 'tool') {
    return isCollapsibleTool((item as FlowToolItem).toolName);
  }

  return false;
}

/**
 * Check whether a FlowItem is collapsible with context.
 * @param item Current item
 * @param nextItem Next item (optional)
 * @param isLast Whether this is the last item
 */
export function isCollapsibleItemWithContext(
  item: FlowItem,
  nextItem: FlowItem | undefined,
  isLast: boolean,
): boolean {
  // Text and thinking depend on what follows.
  if (item.type === 'text' || item.type === 'thinking') {
    // Last item should stay visible.
    if (isLast || !nextItem) return false;

    // If followed by an explorer tool, collapse together.
    if (nextItem.type === 'tool') {
      return isCollapsibleTool((nextItem as FlowToolItem).toolName);
    }

    // If followed by text or thinking, treat as collapsible for grouping.
    if (nextItem.type === 'text' || nextItem.type === 'thinking') {
      return true;
    }

    // Otherwise do not collapse.
    return false;
  }

  // Tools: only explorer tools are collapsible.
  if (item.type === 'tool') {
    return isCollapsibleTool((item as FlowToolItem).toolName);
  }

  return false;
}
