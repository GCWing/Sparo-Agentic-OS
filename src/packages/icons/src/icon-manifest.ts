import metadata from './icons.json';

export const systemIconNames = [
  'sparo-hub',
  'work-center',
  'app-center',
  'daily-letter',
  'memory',
  'files',
  'terminal',
  'skills',
  'tools',
  'subagent',
  'settings',
  'full-open',
  'normal-work',
  'multi-step-work',
  'long-running-work',
  'topic-work',
  'recurring-work',
  'intelligent-app-work',
  'delegated-work',
  'system-work',
  'back',
  'forward',
  'external-open',
  'expand',
  'collapse',
  'close',
  'search',
  'clear',
  'filter',
  'sort',
  'open-directory',
  'upload',
  'download',
  'export',
  'copy',
  'add',
  'edit',
  'delete',
  'save-apply',
  'cancel',
  'reset',
  'undo',
  'refresh',
  'retry',
] as const;

export type SystemIconName = (typeof systemIconNames)[number];
export type SystemIconVariant = 'base' | 'emphasis';
export type SystemIconFamily =
  | 'system'
  | 'work-type'
  | 'navigation'
  | 'search-filter'
  | 'files-transfer'
  | 'edit-manage';

export interface SystemIconMetadata {
  id: SystemIconName;
  family: SystemIconFamily;
  componentName: string;
  label: string;
  labelZh: string;
  tags: string[];
}

const knownNames = new Set<string>(systemIconNames);
for (const icon of metadata) {
  if (!knownNames.has(icon.id)) {
    throw new Error(`Unknown Sparo system icon in metadata: ${icon.id}`);
  }
}

export const systemIconManifest = metadata as SystemIconMetadata[];
