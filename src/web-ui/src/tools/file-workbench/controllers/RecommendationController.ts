import type { FileCapability, FileEntry } from '../types';

export interface FileRecommendation {
  id: FileCapability;
  priority: 'primary' | 'secondary' | 'agent';
  requiresPlan: boolean;
}

export function getSelectionRecommendations(selection: FileEntry[]): FileRecommendation[] {
  if (selection.length === 0) return [];
  const capabilities = new Set<FileCapability>();
  selection.forEach((entry) => entry.capabilities.forEach((capability) => capabilities.add(capability)));

  const recommendations: FileRecommendation[] = [];
  if (capabilities.has('openInSparo') && selection.length === 1) {
    recommendations.push({ id: 'openInSparo', priority: 'primary', requiresPlan: false });
  }
  recommendations.push({ id: 'addToChat', priority: 'secondary', requiresPlan: false });
  recommendations.push({ id: 'askSparo', priority: 'agent', requiresPlan: false });
  if (capabilities.has('openAsWorkspace') && selection.length === 1) {
    recommendations.push({ id: 'openAsWorkspace', priority: 'secondary', requiresPlan: false });
  }
  if (capabilities.has('organize')) {
    recommendations.push({ id: 'organize', priority: 'agent', requiresPlan: true });
  }
  if (capabilities.has('findDuplicates')) {
    recommendations.push({ id: 'findDuplicates', priority: 'agent', requiresPlan: false });
  }
  return recommendations;
}
