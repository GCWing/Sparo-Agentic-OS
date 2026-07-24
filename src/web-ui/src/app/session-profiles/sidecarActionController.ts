import { openActiveAuxiliaryItem } from '@/app/auxiliary-surface';
import { createLogger } from '@/shared/utils/logger';
import type { TabAutoOpenDescriptor } from './types';

const log = createLogger('SessionSidecarActions');

export function openActiveSessionSidecarPanel(panel: TabAutoOpenDescriptor): boolean {
  log.debug('Opening active session sidecar panel', {
    type: panel.type,
    duplicateCheckKey: panel.duplicateCheckKey,
    title: panel.title,
  });
  return openActiveAuxiliaryItem(panel);
}
