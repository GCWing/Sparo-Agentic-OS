import { TAB_EVENTS, type CreateTabEventDetail } from '@/app/components/panels/content-canvas/types';
import { createLogger } from '@/shared/utils/logger';
import type { TabAutoOpenDescriptor } from './types';

const log = createLogger('SessionSidecarActions');

export function openSessionSidecarPanel(panel: TabAutoOpenDescriptor): void {
  const duplicateCheckKey =
    panel.duplicateCheckKey ??
    (typeof panel.metadata?.duplicateCheckKey === 'string'
      ? panel.metadata.duplicateCheckKey
      : undefined);

  const detail: CreateTabEventDetail = {
    type: panel.type,
    title: panel.title,
    data: panel.data,
    metadata: duplicateCheckKey
      ? { ...panel.metadata, duplicateCheckKey }
      : panel.metadata,
    checkDuplicate: Boolean(duplicateCheckKey),
    duplicateCheckKey,
    replaceExisting: panel.replaceExisting ?? true,
    targetGroup: panel.targetGroup,
    enableSplitView: panel.enableSplitView,
  };

  log.debug('Opening session sidecar panel', {
    type: panel.type,
    duplicateCheckKey,
    title: panel.title,
  });

  window.dispatchEvent(
    new CustomEvent(TAB_EVENTS.AGENT_CREATE_TAB, {
      detail,
    })
  );
}
