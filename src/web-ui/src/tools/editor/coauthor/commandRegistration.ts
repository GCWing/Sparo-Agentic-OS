import { commandRegistry } from '@/shared/context-menu-system';
import type { ICommand } from '@/shared/context-menu-system/types';
import { ContextType } from '@/shared/context-menu-system/types';

export const COAUTHOR_COMMAND_EVENT = 'sparo:markdown-coauthor-command';

function dispatchCoauthorCommand(actionId: string, scope: 'selection' | 'block' | 'document', intent: 'apply' | 'review'): void {
  window.dispatchEvent(new CustomEvent(COAUTHOR_COMMAND_EVENT, {
    detail: { actionId, scope, intent },
  }));
}

const commands: ICommand[] = [
  {
    id: 'markdown-coauthor.polish-selection',
    label: 'Co-author: Polish selection',
    category: 'Markdown Co-author',
    canExecute: (context) => context.type === ContextType.EDITOR || context.type === ContextType.SELECTION || context.type === ContextType.CUSTOM,
    execute: () => {
      dispatchCoauthorCommand('polish', 'selection', 'apply');
      return { success: true };
    },
  },
  {
    id: 'markdown-coauthor.review-document',
    label: 'Co-author: Review document',
    category: 'Markdown Co-author',
    canExecute: (context) => context.type === ContextType.EDITOR || context.type === ContextType.CUSTOM,
    execute: () => {
      dispatchCoauthorCommand('consistency_check', 'document', 'review');
      return { success: true };
    },
  },
  {
    id: 'markdown-coauthor.summarize-document',
    label: 'Co-author: Summarize document',
    category: 'Markdown Co-author',
    canExecute: (context) => context.type === ContextType.EDITOR || context.type === ContextType.CUSTOM,
    execute: () => {
      dispatchCoauthorCommand('summary', 'document', 'apply');
      return { success: true };
    },
  },
];

export function registerMarkdownCoauthorCommands(): void {
  commands.forEach(command => {
    if (!commandRegistry.has(command.id)) {
      commandRegistry.register(command);
    }
  });
}
