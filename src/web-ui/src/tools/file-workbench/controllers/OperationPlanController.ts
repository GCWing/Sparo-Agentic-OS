import type { FileEntry, FileScope } from '../types';

export type FileOperationType = 'mkdir' | 'rename' | 'move' | 'copy' | 'delete-to-trash' | 'delete-permanent' | 'archive' | 'extract';

export interface FileOperationPlanItem {
  id: string;
  type: FileOperationType;
  sourcePath?: string;
  targetPath?: string;
  reason: string;
  risk: 'low' | 'medium' | 'high';
  requiresConfirmation: boolean;
  included: boolean;
}

export interface FileOperationPlan {
  id: string;
  title: string;
  scope: FileScope;
  cwd: string;
  createdBy: 'user' | 'agent';
  createdAt: string;
  items: FileOperationPlanItem[];
  summary: {
    total: number;
    highRiskCount: number;
    conflictCount: number;
  };
  status: 'draft' | 'ready' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';
}

export function createReadOnlyPlanDraft(scope: FileScope, cwd: string, selection: FileEntry[], title: string): FileOperationPlan {
  const items: FileOperationPlanItem[] = selection.map((entry, index) => ({
    id: `plan-item-${index}-${entry.id}`,
    type: 'move' as const,
    sourcePath: entry.path,
    reason: 'Draft placeholder for reviewed file operation. Execution requires a concrete target and confirmation.',
    risk: 'medium' as const,
    requiresConfirmation: true,
    included: false,
  }));
  return {
    id: `file-plan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    title,
    scope,
    cwd,
    createdBy: 'user',
    createdAt: new Date().toISOString(),
    items,
    summary: {
      total: items.length,
      highRiskCount: items.filter((item) => item.risk === 'high').length,
      conflictCount: 0,
    },
    status: 'draft',
  };
}
