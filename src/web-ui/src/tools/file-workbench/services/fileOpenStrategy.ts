import { canOpenInExcelLive, canOpenInSparo } from './fileClassification';
import type { FileCapability, FileEntry, FileOpenDecision, FileScope } from '../types';

export function getEntryCapabilities(
  entry: Pick<FileEntry, 'kind' | 'name'> & Partial<Pick<FileEntry, 'capabilities'>>,
): FileCapability[] {
  if (entry.capabilities && entry.capabilities.length > 0) return entry.capabilities;
  const capabilities: FileCapability[] = ['preview', 'addToChat', 'askSparo', 'reveal', 'copyPath'];
  if (entry.kind === 'dir') {
    capabilities.push('openExternal', 'openAsWorkspace', 'summarize', 'organize', 'findDuplicates', 'operationPlan');
    return capabilities;
  }
  capabilities.push('openExternal', 'summarize');
  if (canOpenInExcelLive(entry as FileEntry)) capabilities.unshift('openInExcelLive');
  if (canOpenInSparo(entry as FileEntry)) capabilities.unshift('openInSparo');
  return capabilities;
}

export function decideFileOpenAction(
  entry: FileEntry,
  _options: { scope?: FileScope; userIntent?: 'singleClick' | 'doubleClick' | 'enter' | 'contextMenu' } = {},
): FileOpenDecision {
  const capabilities = getEntryCapabilities(entry);
  if (entry.kind === 'dir') {
    return { primary: 'openFolder', secondary: ['openExternal'], capabilities };
  }
  if (canOpenInExcelLive(entry)) {
    return { primary: 'openInExcelLive', secondary: ['openExternal'], capabilities };
  }
  if (canOpenInSparo(entry)) {
    return { primary: 'openInSparo', secondary: ['openExternal'], capabilities };
  }
  return { primary: 'openExternal', secondary: [], capabilities };
}
