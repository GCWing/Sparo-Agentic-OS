/**
 * Upload / download between workspace and local disk (desktop).
 */

import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { workspaceAPI } from '@/infrastructure/api';
import { i18nService } from '@/infrastructure/i18n';
import type { WorkspaceInfo } from '@/shared/types';

export type TransferPhase = 'download' | 'upload';

export interface TransferProgressState {
  phase: TransferPhase;
  current: number;
  total: number;
  label: string;
  /** Single-file transfer: no byte-level progress from backend — show indeterminate bar */
  indeterminate?: boolean;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export function joinWorkspaceTargetPath(dir: string, fileName: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  const base = dir.replace(/[/\\]+$/, '');
  return `${base}${sep}${fileName}`;
}

export function getParentPathFromFile(filePath: string): string {
  const isWin = filePath.includes('\\');
  const sep = isWin ? '\\' : '/';
  const parts = filePath.split(sep);
  parts.pop();
  return parts.join(sep);
}

export function resolveExplorerDropTargetDirectory(
  clientX: number,
  clientY: number,
  workspacePath: string
): string {
  const el = document.elementFromPoint(clientX, clientY);
  if (!el) {
    return workspacePath;
  }
  const explorer = el.closest('.bitfun-file-explorer');
  if (!explorer) {
    return workspacePath;
  }
  const node = el.closest('[data-file-path]');
  if (!node) {
    return workspacePath;
  }
  const path = node.getAttribute('data-file-path');
  if (!path) {
    return workspacePath;
  }
  const isDir = node.getAttribute('data-is-directory') === 'true';
  if (isDir) {
    return path;
  }
  return getParentPathFromFile(path) || workspacePath;
}

/**
 * Tauri emits physical pixel positions; `elementFromPoint` / `getBoundingClientRect` use logical CSS pixels.
 * Try a few conversions because platform / overlay titlebars can differ.
 */
export function resolveDropTargetDirectoryFromDragPosition(
  position: { x: number; y: number },
  scaleFactor: number,
  workspacePath: string
): string {
  const logical = new PhysicalPosition(position.x, position.y).toLogical(scaleFactor);
  const candidates: { x: number; y: number }[] = [
    { x: logical.x, y: logical.y },
    { x: position.x, y: position.y },
    { x: position.x / scaleFactor, y: position.y / scaleFactor },
  ];
  for (const { x, y } of candidates) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    const hit = document.elementFromPoint(x, y);
    if (!hit?.closest('.bitfun-file-explorer')) {
      continue;
    }
    return resolveExplorerDropTargetDirectory(x, y, workspacePath);
  }
  return workspacePath;
}

export function isDragPositionOverElement(
  position: { x: number; y: number },
  scaleFactor: number,
  element: HTMLElement | null
): boolean {
  if (!element) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const logical = new PhysicalPosition(position.x, position.y).toLogical(scaleFactor);
  const candidates = [
    { x: logical.x, y: logical.y },
    { x: position.x, y: position.y },
    { x: position.x / scaleFactor, y: position.y / scaleFactor },
  ];
  for (const { x, y } of candidates) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return true;
    }
  }
  return false;
}

export async function downloadWorkspaceFileToDisk(
  filePath: string,
  _workspace: WorkspaceInfo | null,
  onProgress: (state: TransferProgressState | null) => void
): Promise<void> {
  if (!isTauri()) {
    throw new Error(i18nService.t('common:file.transferNeedsDesktop'));
  }
  const { save } = await import('@tauri-apps/plugin-dialog');
  const baseName = filePath.split(/[/\\]/).pop() || 'file';
  const dest = await save({
    title: i18nService.t('common:file.downloadSaveTitle'),
    defaultPath: baseName,
  });
  if (dest === null) {
    return;
  }

  onProgress({
    phase: 'download',
    current: 0,
    total: 1,
    label: baseName,
    indeterminate: true,
  });
  try {
    await workspaceAPI.exportLocalFileToPath(filePath, dest);
    onProgress({
      phase: 'download',
      current: 1,
      total: 1,
      label: baseName,
      indeterminate: false,
    });
  } finally {
    window.setTimeout(() => onProgress(null), 450);
  }
}

export async function uploadLocalPathsToWorkspaceDirectory(
  localPaths: string[],
  targetDirectory: string,
  _workspace: WorkspaceInfo | null,
  onProgress: (state: TransferProgressState | null) => void
): Promise<void> {
  if (!isTauri()) {
    throw new Error(i18nService.t('common:file.transferNeedsDesktop'));
  }
  if (localPaths.length === 0) {
    return;
  }
  const total = localPaths.length;
  for (let i = 0; i < total; i++) {
    const lp = localPaths[i]!;
    const name = lp.split(/[/\\]/).pop();
    if (!name) {
      continue;
    }
    const destPath = joinWorkspaceTargetPath(targetDirectory, name);
    onProgress({
      phase: 'upload',
      current: i,
      total,
      label: name,
      indeterminate: total === 1,
    });
    await workspaceAPI.exportLocalFileToPath(lp, destPath);
  }
  onProgress({
    phase: 'upload',
    current: total,
    total,
    label: '',
    indeterminate: false,
  });
  window.setTimeout(() => onProgress(null), 450);
}
