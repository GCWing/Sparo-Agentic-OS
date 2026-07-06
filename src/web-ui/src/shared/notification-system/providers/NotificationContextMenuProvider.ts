 

import { contextMenuRegistry } from '@/shared/context-menu-system';
import type { MenuContext, MenuItem } from '@/shared/context-menu-system/types';
import { i18nService } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import { copyTextToClipboard } from '@/shared/utils/textSelection';

const log = createLogger('NotificationContextMenuProvider');

function copyNotificationText(text: string, source: 'title' | 'message' | 'all'): void {
  const normalizedText = text.trim();
  if (!normalizedText) {
    log.warn('Skipped notification copy because text was empty', { source });
    return;
  }

  void copyTextToClipboard(normalizedText).then((copied) => {
    if (!copied) {
      log.error('Failed to copy notification text', { source });
    }
  });
}

 
export function registerNotificationContextMenu(): void {
  contextMenuRegistry.register({
    id: 'notification-menu',
    name: i18nService.t('common:contextMenu.notificationMenu.name'),
    description: i18nService.t('common:contextMenu.notificationMenu.description'),
    priority: 100,
    matcher: (context: MenuContext) => {
      
      const target = context.targetElement;
      return !!(target?.closest('[data-context-type="notification"]'));
    },
    menuBuilder: (context: MenuContext): MenuItem[] => {
      
      const notificationElement = context.targetElement?.closest('[data-context-type="notification"]') as HTMLElement;
      if (!notificationElement) {
        return [];
      }

      const title = notificationElement.getAttribute('data-notification-title') || '';
      const message = notificationElement.getAttribute('data-notification-message') || '';

      return [
        {
          id: 'copy-title',
          label: i18nService.t('common:contextMenu.notificationMenu.items.copyTitle'),
          icon: 'Copy',
          onClick: () => {
            copyNotificationText(title, 'title');
          }
        },
        {
          id: 'copy-message',
          label: i18nService.t('common:contextMenu.notificationMenu.items.copyMessage'),
          icon: 'Copy',
          onClick: () => {
            copyNotificationText(message, 'message');
          }
        },
        {
          id: 'divider-1',
          label: '',
          separator: true
        },
        {
          id: 'copy-all',
          label: i18nService.t('common:contextMenu.notificationMenu.items.copyAll'),
          icon: 'Copy',
          onClick: () => {
            const text = `${title}\n${message}`;
            copyNotificationText(text, 'all');
          }
        }
      ];
    }
  });

  log.info('Notification context menu provider registered');
}

