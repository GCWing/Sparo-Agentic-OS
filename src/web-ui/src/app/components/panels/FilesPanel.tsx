/**
 * Files panel component
 * Displays the file explorer for the current workspace
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search as SearchIcon, CaseSensitive, Regex, WholeWord, List } from 'lucide-react';
import {
  FileExplorer,
  getNewItemParentPath,
  useFileSystem,
  type FileExplorerToolbarHandlers,
} from '@/tools/file-system';
import { useExplorerSearch } from '@/tools/file-explorer';
import { Button, Search, IconButton, SegmentedControl } from '@/design-system';
import { FileSearchResults } from '@/tools/file-system/components/FileSearchResults';
import { workspaceAPI } from '@/infrastructure/api';
import type { FileSystemNode } from '@/tools/file-system/types';
import { globalEventBus } from '@/infrastructure/event-bus';
import { useNotification } from '@/shared/notification-system';
import { InputDialog, CubeLoading } from '@/design-system';
import { openFileInBestTarget } from '@/shared/utils/tabUtils';
import { PanelHeader } from './base';
import { createLogger } from '@/shared/utils/logger';
import {
  basenamePath,
  dirnameAbsolutePath,
  normalizeLocalPathForRename,
  pathsEquivalentFs,
  replaceBasename,
} from '@/shared/utils/pathUtils';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import {
  ContextType,
  useContextMenuStore,
  type MenuItem,
} from '@/shared/context-menu-system';
import {
  downloadWorkspaceFileToDisk,
  isDragPositionOverElement,
  resolveDropTargetDirectoryFromDragPosition,
  uploadLocalPathsToWorkspaceDirectory,
  type TransferProgressState,
} from '@/tools/file-system/services/workspaceFileTransfer';
import '@/tools/file-system/styles/FileExplorer.scss';
import './FilesPanel.scss';

const log = createLogger('FilesPanel');
const FOCUS_REFRESH_THROTTLE_MS = 1000;

function joinDirectoryEntryPath(directory: string, name: string): string {
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/';
  return `${directory.replace(/[\\/]+$/, '')}${separator}${name}`;
}

interface FilesPanelProps {
  workspacePath?: string;
  onFileSelect?: (filePath: string, fileName: string) => void;
  hideHeader?: boolean;
  viewMode?: 'tree' | 'search';
  onViewModeChange?: (mode: 'tree' | 'search') => void;
  /** Hide the in-explorer floating toolbar; parent can render equivalent actions (e.g. file viewer nav header). */
  hideExplorerToolbar?: boolean;
  onExplorerToolbarApi?: (api: FileExplorerToolbarHandlers | null) => void;
}

const FilesPanel: React.FC<FilesPanelProps> = ({
  workspacePath,
  onFileSelect,
  hideHeader = false,
  viewMode: externalViewMode,
  onViewModeChange,
  hideExplorerToolbar = false,
  onExplorerToolbarApi,
}) => {
  const { t } = useTranslation('panels/files');
  
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocusRefreshAtRef = useRef<number>(0);
  const [internalViewMode, setInternalViewMode] = useState<'tree' | 'search'>('tree');
  const viewMode = externalViewMode !== undefined ? externalViewMode : internalViewMode;
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    searchMode,
    setSearchMode,
    allGroups: searchResults,
    isSearching,
    error: searchError,
    filenameLimit,
    contentLimit,
    filenameTruncated,
    contentTruncated,
    searchOptions,
    setSearchOptions,
    clearSearch,
  } = useExplorerSearch({
    workspacePath,
    initialMode: 'content',
    filenameSearchDebounce: 300,
    contentSearchDebounce: 300,
    minFilenameLength: 1,
    minContentLength: 2,
    filenameMaxResults: 500,
    contentMaxResults: 1000,
  });

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [transferProgress, setTransferProgress] = useState<TransferProgressState | null>(null);
  const [fileDropHighlight, setFileDropHighlight] = useState(false);
  const [inputDialog, setInputDialog] = useState<{
    isOpen: boolean;
    type: 'newFile' | 'newFolder' | null;
    parentPath: string;
  }>({
    isOpen: false,
    type: null,
    parentPath: '',
  });

  const notification = useNotification();
  const showContextMenu = useContextMenuStore((state) => state.showMenu);
  const searchLimitNotice =
    searchMode === 'content'
      ? contentTruncated
        ? t('search.limitReachedContent', { count: contentLimit })
        : null
      : filenameTruncated
        ? t('search.limitReachedFiles', { count: filenameLimit })
        : null;

  const {
    fileTree,
    selectedFile,
    expandedFolders,
    loadingPaths,
    loading,
    error,
    loadFileTree,
    selectFile,
    expandFolder,
    expandFolderLazy,
    expandFolderEnsure,
  } = useFileSystem({
    rootPath: workspacePath,
    autoLoad: true,
    showHiddenFiles: false,
    enableAutoWatch: true,
  });
  const handleNodeExpandLazy = useCallback((path: string) => {
    expandFolderLazy(path);
  }, [expandFolderLazy]);

  const prevWorkspacePathRef = useRef<string | undefined>(workspacePath);
  useEffect(() => {
    if (prevWorkspacePathRef.current !== undefined && prevWorkspacePathRef.current !== workspacePath) {
      log.debug('Workspace path changed, clearing local state', {
        from: prevWorkspacePathRef.current,
        to: workspacePath
      });
      
      clearSearch();
      setRenamingPath(null);
      setInputDialog({
        isOpen: false,
        type: null,
        parentPath: '',
      });
      if (onViewModeChange) {
        onViewModeChange('tree');
      } else {
        setInternalViewMode('tree');
      }
    }
    prevWorkspacePathRef.current = workspacePath;
  }, [workspacePath, clearSearch, onViewModeChange]);

  // ===== File Operation Handlers =====
  
  const handleOpenFile = useCallback((data: { path: string; line?: number; column?: number }) => {
    log.info('Opening file', { path: data.path, line: data.line, column: data.column });

    openFileInBestTarget({
      filePath: data.path,
      workspacePath,
      ...(data.line ? { jumpToLine: data.line } : {}),
      ...(data.column ? { jumpToColumn: data.column } : {}),
    });
  }, [workspacePath]);

  const handleNewFile = useCallback((data: { parentPath: string }) => {
    setInputDialog({
      isOpen: true,
      type: 'newFile',
      parentPath: data.parentPath,
    });
  }, []);

  const handleInputDialogClose = useCallback(() => {
    setInputDialog({
      isOpen: false,
      type: null,
      parentPath: '',
    });
  }, []);

  const handleConfirmNewFile = useCallback(async (fileName: string) => {
    const filePath = `${inputDialog.parentPath}${inputDialog.parentPath.endsWith('/') ? '' : '/'}${fileName}`;
    
    try {
      await workspaceAPI.createFile(filePath);
      log.info('File created', { path: filePath });
      handleInputDialogClose();
      loadFileTree(workspacePath || '', true);
    } catch (error) {
      log.error('Failed to create file', error);
      notification.error(t('notifications.createFileFailed', { error: String(error) }));
    }
  }, [inputDialog.parentPath, workspacePath, loadFileTree, notification, t, handleInputDialogClose]);

  const handleNewFolder = useCallback((data: { parentPath: string }) => {
    setInputDialog({
      isOpen: true,
      type: 'newFolder',
      parentPath: data.parentPath,
    });
  }, []);

  const handleConfirmNewFolder = useCallback(async (folderName: string) => {
    const folderPath = `${inputDialog.parentPath}${inputDialog.parentPath.endsWith('/') ? '' : '/'}${folderName}`;
    
    try {
      await workspaceAPI.createDirectory(folderPath);
      log.info('Directory created', { path: folderPath });
      handleInputDialogClose();
      loadFileTree(workspacePath || '', true);
    } catch (error) {
      log.error('Failed to create directory', error);
      notification.error(t('notifications.createFolderFailed', { error: String(error) }));
    }
  }, [inputDialog.parentPath, workspacePath, loadFileTree, notification, t, handleInputDialogClose]);

  const handleInputDialogConfirm = useCallback((value: string) => {
    if (inputDialog.type === 'newFile') {
      handleConfirmNewFile(value);
    } else if (inputDialog.type === 'newFolder') {
      handleConfirmNewFolder(value);
    }
  }, [inputDialog.type, handleConfirmNewFile, handleConfirmNewFolder]);

  const handleStartRename = useCallback((data: { path: string; name: string }) => {
    setRenamingPath(data.path);
  }, []);

  const handleExecuteRename = useCallback(async (oldPath: string, newName: string) => {
    const normalizedOld = normalizeLocalPathForRename(oldPath);
    const oldName = basenamePath(normalizedOld);

    if (newName.trim() === oldName) {
      setRenamingPath(null);
      return;
    }

    const newPath = replaceBasename(normalizedOld, newName.trim());

    try {
      await workspaceAPI.renameFile(normalizedOld, newPath);
      log.info('File renamed', { oldPath: normalizedOld, newPath });
      setRenamingPath(null);
      loadFileTree(workspacePath || '', true);
    } catch (error) {
      log.error('Failed to rename file', error);
      notification.error(t('notifications.renameFailed', { error: String(error) }));
      setRenamingPath(null);
    }
  }, [workspacePath, loadFileTree, notification, t]);

  const handleCancelRename = useCallback(() => {
    setRenamingPath(null);
  }, []);

  const handleMoveToDirectory = useCallback(async (sourcePath: string, targetDirectory: string) => {
    const normalizedSource = normalizeLocalPathForRename(sourcePath);
    const normalizedTargetDirectory = normalizeLocalPathForRename(targetDirectory);
    const sourceName = basenamePath(normalizedSource);

    if (!sourceName) {
      return;
    }

    if (pathsEquivalentFs(dirnameAbsolutePath(normalizedSource), normalizedTargetDirectory)) {
      return;
    }

    const newPath = joinDirectoryEntryPath(normalizedTargetDirectory, sourceName);
    if (pathsEquivalentFs(normalizedSource, newPath)) {
      return;
    }

    try {
      await workspaceAPI.renameFile(normalizedSource, newPath);
      log.info('File moved', {
        oldPath: normalizedSource,
        newPath,
        targetDirectory: normalizedTargetDirectory,
      });
      expandFolder(normalizedTargetDirectory, true);
      selectFile(newPath);
      await loadFileTree(workspacePath || '', true);
    } catch (error) {
      log.error('Failed to move file', error);
      notification.error(t('notifications.moveFailed', { error: String(error) }));
    }
  }, [workspacePath, loadFileTree, expandFolder, selectFile, notification, t]);

  const handleDelete = useCallback(async (data: { path: string; isDirectory: boolean }) => {
    try {
      if (data.isDirectory) {
        await workspaceAPI.deleteDirectory(data.path);
      } else {
        await workspaceAPI.deleteFile(data.path);
      }
      log.info('File deleted', { path: data.path, isDirectory: data.isDirectory });
      loadFileTree(workspacePath || '', true);
    } catch (error) {
      log.error('Failed to delete file', error);
      notification.error(t('notifications.deleteFailed', { error: String(error) }));
    }
  }, [workspacePath, loadFileTree, notification, t]);

  const handleReveal = useCallback(async (data: { path: string }) => {
    try {
      await workspaceAPI.revealInExplorer(data.path);
    } catch (error) {
      log.error('Failed to reveal in explorer', error);
      notification.error(t('notifications.openExplorerFailed', { error: String(error) }));
    }
  }, [notification, t]);

  const handleFileDownload = useCallback(
    async (data: { path: string }) => {
      const ws = workspaceManager.getState().lastUsedWorkspace;
      try {
        await downloadWorkspaceFileToDisk(data.path, ws, setTransferProgress);
      } catch (error) {
        log.error('Failed to download file', error);
        setTransferProgress(null);
        notification.error(t('transfer.failed', { error: String(error) }));
      }
    },
    [notification, t]
  );

  const handleFileTreeRefresh = useCallback(() => {
    loadFileTree(undefined, true);
  }, [loadFileTree]);

  const triggerFocusCompensatingRefresh = useCallback((reason: 'windowFocus' | 'visibilityVisible') => {
    if (!workspacePath || viewMode !== 'tree') {
      return;
    }

    const panelEl = panelRef.current;
    if (!panelEl || panelEl.getClientRects().length === 0) {
      return;
    }

    const now = Date.now();
    if (now - lastFocusRefreshAtRef.current < FOCUS_REFRESH_THROTTLE_MS) {
      return;
    }

    lastFocusRefreshAtRef.current = now;
    log.debug('Compensating file tree refresh after focus/visibility', {
      reason,
      workspacePath,
    });
    void loadFileTree(undefined, true);
  }, [workspacePath, viewMode, loadFileTree]);

  const handleNavigateToPath = useCallback((data: { path: string; scrollIntoView?: boolean }) => {
    if (!data.path || !workspacePath) {
      return;
    }

    log.debug('Navigating to path', { path: data.path, scrollIntoView: data.scrollIntoView });

    const normalizedTarget = data.path.replace(/\\/g, '/');
    const normalizedWorkspace = workspacePath.replace(/\\/g, '/');

    let relativePath = normalizedTarget;
    if (normalizedTarget.toLowerCase().startsWith(normalizedWorkspace.toLowerCase())) {
      relativePath = normalizedTarget.slice(normalizedWorkspace.length).replace(/^\//, '');
    }

    const parts = relativePath.split('/').filter(Boolean);
    let currentPath = normalizedWorkspace;
    const isWindowsPath = workspacePath.includes('\\');

    const targetPaths = new Set<string>();
    targetPaths.add(isWindowsPath ? normalizedWorkspace.replace(/\//g, '\\') : normalizedWorkspace);

    let finalExpandPath = '';
    const pathsToExpand: string[] = [];
    for (const part of parts) {
      currentPath = `${currentPath}/${part}`;
      const expandPath = isWindowsPath ? currentPath.replace(/\//g, '\\') : currentPath;
      finalExpandPath = expandPath;
      targetPaths.add(expandPath);
      pathsToExpand.push(expandPath);
    }

    expandedFolders.forEach(folderPath => {
      if (!targetPaths.has(folderPath)) {
        expandFolder(folderPath, false);
      }
    });

    const performScroll = () => {
      if (!data.scrollIntoView || !finalExpandPath) {
        return;
      }
      const escapedPath = finalExpandPath.replace(/\\/g, '\\\\');
      const targetElement = document.querySelector(`[data-file-path="${escapedPath}"]`);
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetElement.classList.add('sparo-file-explorer__node-content--highlighted');
        setTimeout(() => {
          targetElement.classList.remove('sparo-file-explorer__node-content--highlighted');
        }, 2000);
      }
    };

    void (async () => {
      for (const expandPath of pathsToExpand) {
        try {
          await expandFolderEnsure(expandPath);
        } catch (err) {
          log.warn('Failed to expand path during navigation', { expandPath, err });
          break;
        }
      }
      setTimeout(performScroll, 100);
    })();
  }, [workspacePath, expandFolder, expandFolderEnsure, expandedFolders]);

  const getParentDirectory = useCallback((filePath: string): string => {
    return dirnameAbsolutePath(filePath);
  }, []);

  const findNode = useCallback((nodes: FileSystemNode[], path: string): FileSystemNode | null => {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.children) {
        const found = findNode(node.children, path);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const executePaste = useCallback(async (targetDir?: string) => {
    if (!workspacePath) {
      notification.warning(t('notifications.selectWorkspaceFirst'));
      return;
    }

    try {
      const { files, isCut } = await workspaceAPI.getClipboardFiles();
      
      if (files.length === 0) {
        notification.info(t('notifications.pasteNoFiles'));
        return;
      }

      let targetDirectory = targetDir || workspacePath;
      
      if (!targetDir && selectedFile) {
        const selectedNode = findNode(fileTree, selectedFile);
        if (selectedNode) {
          if (selectedNode.isDirectory) {
            targetDirectory = selectedFile;
          } else {
            targetDirectory = getParentDirectory(selectedFile);
          }
        }
      }

      notification.info(t('notifications.pastingFiles', { count: files.length, target: targetDirectory.split(/[/\\]/).pop() }));
      
      const result = await workspaceAPI.pasteFiles(files, targetDirectory, isCut);
      
      if (result.successCount > 0) {
        notification.success(t('notifications.pasteSuccess', { count: result.successCount }));
        loadFileTree(undefined, true);
        
        if (targetDirectory !== workspacePath) {
          expandFolder(targetDirectory, true);
        }
      }
      
      if (result.failedFiles.length > 0) {
        const failedNames = result.failedFiles.map(f => {
          const name = f.path.split(/[/\\]/).pop() || f.path;
          return `${name}: ${f.error}`;
        }).join('\n');
        notification.error(t('notifications.pasteFailed', { count: result.failedFiles.length }) + `:\n${failedNames}`, { duration: 5000 });
      }
      
    } catch (error) {
      log.error('Failed to paste files', error);
      notification.error(t('notifications.pasteFailed', { count: 1 }));
    }
  }, [workspacePath, selectedFile, fileTree, notification, loadFileTree, expandFolder, findNode, getParentDirectory, t]);

  const handlePasteFromContextMenu = useCallback((data: { targetDirectory: string }) => {
    executePaste(data.targetDirectory);
  }, [executePaste]);

  const handlePasteFromKeyboard = useCallback(() => {
    executePaste();
  }, [executePaste]);

  const eventHandlersRef = useRef({
    handleOpenFile,
    handleNewFile,
    handleNewFolder,
    handleStartRename,
    handleDelete,
    handleReveal,
    handleFileDownload,
    handlePasteFromContextMenu,
    handleFileTreeRefresh,
    handleNavigateToPath,
  });

  eventHandlersRef.current = {
    handleOpenFile,
    handleNewFile,
    handleNewFolder,
    handleStartRename,
    handleDelete,
    handleReveal,
    handleFileDownload,
    handlePasteFromContextMenu,
    handleFileTreeRefresh,
    handleNavigateToPath,
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!panelRef.current?.contains(document.activeElement) && 
          !panelRef.current?.contains(e.target as Node)) {
        return;
      }

      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        e.stopPropagation();
        handlePasteFromKeyboard();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handlePasteFromKeyboard]);

  useEffect(() => {
    const handleOpen = (data: { path: string; line?: number; column?: number }) =>
      eventHandlersRef.current.handleOpenFile(data);
    const handleNewFileEvent = (data: { parentPath: string }) =>
      eventHandlersRef.current.handleNewFile(data);
    const handleNewFolderEvent = (data: { parentPath: string }) =>
      eventHandlersRef.current.handleNewFolder(data);
    const handleRename = (data: { path: string; name: string }) =>
      eventHandlersRef.current.handleStartRename(data);
    const handleDeleteEvent = (data: { path: string; isDirectory: boolean }) =>
      eventHandlersRef.current.handleDelete(data);
    const handleRevealEvent = (data: { path: string }) =>
      eventHandlersRef.current.handleReveal(data);
    const handleDownload = (data: { path: string }) =>
      eventHandlersRef.current.handleFileDownload(data);
    const handlePaste = (data: { targetDirectory: string }) =>
      eventHandlersRef.current.handlePasteFromContextMenu(data);
    const handleRefresh = () =>
      eventHandlersRef.current.handleFileTreeRefresh();
    const handleNavigate = (data: { path: string; scrollIntoView?: boolean }) =>
      eventHandlersRef.current.handleNavigateToPath(data);

    globalEventBus.on('file:open', handleOpen);
    globalEventBus.on('file:new-file', handleNewFileEvent);
    globalEventBus.on('file:new-folder', handleNewFolderEvent);
    globalEventBus.on('file:rename', handleRename);
    globalEventBus.on('file:delete', handleDeleteEvent);
    globalEventBus.on('file:reveal', handleRevealEvent);
    globalEventBus.on('file:download', handleDownload);
    globalEventBus.on('file:paste', handlePaste);
    globalEventBus.on('file-tree:refresh', handleRefresh);
    globalEventBus.on('file-explorer:navigate', handleNavigate);

    return () => {
      globalEventBus.off('file:open', handleOpen);
      globalEventBus.off('file:new-file', handleNewFileEvent);
      globalEventBus.off('file:new-folder', handleNewFolderEvent);
      globalEventBus.off('file:rename', handleRename);
      globalEventBus.off('file:delete', handleDeleteEvent);
      globalEventBus.off('file:reveal', handleRevealEvent);
      globalEventBus.off('file:download', handleDownload);
      globalEventBus.off('file:paste', handlePaste);
      globalEventBus.off('file-tree:refresh', handleRefresh);
      globalEventBus.off('file-explorer:navigate', handleNavigate);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleWindowFocus = () => {
      triggerFocusCompensatingRefresh('windowFocus');
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerFocusCompensatingRefresh('visibilityVisible');
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [triggerFocusCompensatingRefresh]);

  useEffect(() => {
    if (typeof window === 'undefined' || !(('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) || !workspacePath) {
      return;
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let lastEnterPaths: string[] = [];

    const setup = async () => {
      try {
        // File-drop IPC is scoped to the webview; Window.onDragDropEvent may not receive events.
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const webview = getCurrentWebview();
        unlisten = await webview.onDragDropEvent(async (event) => {
          if (cancelled) return;
          const payload = event.payload;
          if (payload.type === 'leave') {
            setFileDropHighlight(false);
            lastEnterPaths = [];
            return;
          }
          if (payload.type === 'enter') {
            lastEnterPaths = payload.paths;
            return;
          }
          if (payload.type === 'over') {
            const factor = await webview.window.scaleFactor();
            const panelEl = panelRef.current;
            setFileDropHighlight(
              isDragPositionOverElement(payload.position, factor, panelEl)
            );
            return;
          }
          if (payload.type === 'drop') {
            setFileDropHighlight(false);
            const paths =
              payload.paths.length > 0 ? payload.paths : [...lastEnterPaths];
            lastEnterPaths = [];
            if (!workspacePath || paths.length === 0) {
              return;
            }

            const factor = await webview.window.scaleFactor();
            const targetDir = resolveDropTargetDirectoryFromDragPosition(
              payload.position,
              factor,
              workspacePath
            );

            const ws = workspaceManager.getState().lastUsedWorkspace;
            try {
              await uploadLocalPathsToWorkspaceDirectory(
                paths,
                targetDir,
                ws,
                setTransferProgress
              );
              loadFileTree(workspacePath, true);
              if (targetDir !== workspacePath) {
                expandFolder(targetDir, true);
              }
            } catch (error) {
              log.error('Failed to upload dropped files', error);
              setTransferProgress(null);
              notification.error(t('transfer.failed', { error: String(error) }));
            }
          }
        });
      } catch (e) {
        log.warn('File drag-drop listener not available', e);
      }
    };

    void setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [workspacePath, loadFileTree, expandFolder, notification, t]);

  const handleFileSelect = useCallback((filePath: string, fileName: string) => {
    selectFile(filePath);
    onFileSelect?.(filePath, fileName);
    
    const selectedNode = findNode(fileTree, filePath);
    if (selectedNode && !selectedNode.isDirectory) {
      openFileInBestTarget({
        filePath,
        fileName,
        workspacePath,
      }, { source: 'project-nav' });
    }
  }, [selectFile, onFileSelect, workspacePath, fileTree, findNode]);

  const handleSearchResultSelect = useCallback((filePath: string, fileName: string) => {
    selectFile(filePath);
    onFileSelect?.(filePath, fileName);
  }, [selectFile, onFileSelect]);

  const handleSearchFolderNavigate = useCallback((folderPath: string, _folderName: string) => {
    if (onViewModeChange) {
      onViewModeChange('tree');
    } else {
      setInternalViewMode('tree');
    }
    selectFile(folderPath);
    setTimeout(() => {
      handleNavigateToPath({ path: folderPath, scrollIntoView: true });
    }, 0);
  }, [onViewModeChange, selectFile, handleNavigateToPath]);

  const handleClearSearch = useCallback(() => {
    clearSearch();
  }, [clearSearch]);

  const handleToggleViewMode = useCallback(() => {
    const next = viewMode === 'tree' ? 'search' : 'tree';
    if (onViewModeChange) {
      onViewModeChange(next);
    } else {
      setInternalViewMode(next);
    }
  }, [viewMode, onViewModeChange]);

  const handleExplorerToolbarNewFile = useCallback(() => {
    const parentPath = getNewItemParentPath(workspacePath, selectedFile, fileTree);
    if (parentPath) {
      handleNewFile({ parentPath });
    }
  }, [workspacePath, selectedFile, fileTree, handleNewFile]);

  const handleExplorerToolbarNewFolder = useCallback(() => {
    const parentPath = getNewItemParentPath(workspacePath, selectedFile, fileTree);
    if (parentPath) {
      handleNewFolder({ parentPath });
    }
  }, [workspacePath, selectedFile, fileTree, handleNewFolder]);

  const handleExplorerToolbarRefresh = useCallback(() => {
    loadFileTree(workspacePath || '', false);
  }, [loadFileTree, workspacePath]);

  const handleTreeBlankContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!workspacePath || viewMode !== 'tree') {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest('[data-file-path]') || target.closest('.sparo-file-explorer__toolbar')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const parentPath = getNewItemParentPath(workspacePath, selectedFile, fileTree) || workspacePath;
    const items: MenuItem[] = [
      {
        id: 'file-blank-new-file',
        label: t('dialog.newFile.title'),
        icon: 'FilePlus',
        onClick: () => handleNewFile({ parentPath }),
      },
      {
        id: 'file-blank-new-folder',
        label: t('dialog.newFolder.title'),
        icon: 'FolderPlus',
        onClick: () => handleNewFolder({ parentPath }),
      },
      {
        id: 'file-blank-separator-paste',
        label: '',
        separator: true,
      },
      {
        id: 'file-blank-paste',
        label: t('common:actions.paste'),
        icon: 'Clipboard',
        shortcut: 'Ctrl+V',
        onClick: () => {
          void executePaste(parentPath);
        },
      },
      {
        id: 'file-blank-separator-refresh',
        label: '',
        separator: true,
      },
      {
        id: 'file-blank-refresh',
        label: t('common:actions.refresh'),
        icon: 'RefreshCw',
        onClick: () => loadFileTree(workspacePath, true),
      },
    ];

    showContextMenu(
      { x: event.clientX, y: event.clientY },
      items,
      {
        type: ContextType.EMPTY_SPACE,
        area: 'file-explorer',
        event,
        targetElement: event.currentTarget,
        position: { x: event.clientX, y: event.clientY },
        timestamp: Date.now(),
      },
    );
  }, [
    executePaste,
    fileTree,
    handleNewFile,
    handleNewFolder,
    loadFileTree,
    selectedFile,
    showContextMenu,
    t,
    viewMode,
    workspacePath,
  ]);

  const explorerToolbarApi = React.useMemo<FileExplorerToolbarHandlers | null>(() => {
    if (!workspacePath || viewMode !== 'tree') {
      return null;
    }

    return {
      onNewFile: handleExplorerToolbarNewFile,
      onNewFolder: handleExplorerToolbarNewFolder,
      onRefresh: handleExplorerToolbarRefresh,
    };
  }, [
    workspacePath,
    viewMode,
    handleExplorerToolbarNewFile,
    handleExplorerToolbarNewFolder,
    handleExplorerToolbarRefresh,
  ]);

  useEffect(() => {
    if (!onExplorerToolbarApi) return;
    onExplorerToolbarApi(hideExplorerToolbar ? explorerToolbarApi : null);
  }, [
    onExplorerToolbarApi,
    hideExplorerToolbar,
    explorerToolbarApi,
  ]);

  useEffect(() => {
    if (!onExplorerToolbarApi) return;
    return () => onExplorerToolbarApi(null);
  }, [onExplorerToolbarApi]);

  return (
    <div 
      ref={panelRef}
      className="sparo-files-panel"
      tabIndex={-1}
      onFocus={() => {}}
    >
      {!hideHeader && (
        <PanelHeader
          title={t('title')}
          className="sparo-files-panel__header"
          actions={
            workspacePath && (
              <IconButton
                size="xs"
                onClick={handleToggleViewMode}
                tooltip={viewMode === 'tree' ? t('actions.switchToSearch') : t('actions.switchToTree')}
                tooltipPlacement="bottom"
              >
                {viewMode === 'tree' ? <SearchIcon size={14} /> : <List size={14} />}
              </IconButton>
            )
          }
        />
      )}
      
      <div className="sparo-files-panel__content">
        {workspacePath && viewMode === 'search' && (
          <div className="sparo-files-panel__search">
            <Search
              placeholder={t('search.placeholder')}
              value={searchQuery}
              onChange={(val) => setSearchQuery(val)}
              onClear={handleClearSearch}
              clearable
              size="small"
              loading={isSearching}
            />
            <div className="sparo-files-panel__search-toolbar">
              <div className="sparo-files-panel__search-modes">
                <SegmentedControl
                  size="small"
                  value={searchMode}
                  onChange={(nextMode) => setSearchMode(nextMode as typeof searchMode)}
                  ariaLabel={t('search.placeholder')}
                  options={[
                    { value: 'content', label: t('search.modeContent') },
                    { value: 'filenames', label: t('search.modeFiles') },
                  ]}
                />
              </div>
              <div className="sparo-files-panel__search-options">
                <IconButton
                  size="xs"
                  variant={searchOptions.caseSensitive ? 'primary' : 'ghost'}
                  tooltip={t('options.caseSensitive')}
                  aria-label={t('options.caseSensitive')}
                  aria-pressed={searchOptions.caseSensitive}
                  onClick={() => setSearchOptions(prev => ({ ...prev, caseSensitive: !prev.caseSensitive }))}
                >
                  <CaseSensitive size={14} />
                </IconButton>
                <IconButton
                  size="xs"
                  variant={searchOptions.wholeWord ? 'primary' : 'ghost'}
                  tooltip={t('options.wholeWord')}
                  aria-label={t('options.wholeWord')}
                  aria-pressed={searchOptions.wholeWord}
                  onClick={() => setSearchOptions(prev => ({ ...prev, wholeWord: !prev.wholeWord }))}
                >
                  <WholeWord size={14} />
                </IconButton>
                <IconButton
                  size="xs"
                  variant={searchOptions.useRegex ? 'primary' : 'ghost'}
                  tooltip={t('options.useRegex')}
                  aria-label={t('options.useRegex')}
                  aria-pressed={searchOptions.useRegex}
                  onClick={() => setSearchOptions(prev => ({ ...prev, useRegex: !prev.useRegex }))}
                >
                  <Regex size={14} />
                </IconButton>
              </div>
            </div>
          </div>
        )}

        <div
          className={`sparo-files-panel__main-content${
            fileDropHighlight ? ' sparo-files-panel__main-content--drop-target' : ''
          }`}
          data-area={workspacePath && viewMode === 'tree' ? 'file-explorer' : undefined}
          data-workspace-root={workspacePath && viewMode === 'tree' ? workspacePath : undefined}
          data-file-list={workspacePath && viewMode === 'tree' ? 'true' : undefined}
          onContextMenu={handleTreeBlankContextMenu}
        >
        {!workspacePath ? (
          <div className="sparo-files-panel__placeholder">
            <div className="sparo-files-panel__placeholder-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10,9 9,9 8,9"/>
              </svg>
            </div>
            <p>{t('empty.selectWorkspace')}</p>
          </div>
        ) : viewMode === 'search' ? (
          searchQuery ? (
            <div className="sparo-files-panel__search-content">
              {searchLimitNotice && (
                <div className="sparo-files-panel__search-limit-notice">
                  <span>{searchLimitNotice}</span>
                </div>
              )}
              
              {searchError && (
                <div className="sparo-files-panel__error">
                  <p>{searchError}</p>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => setSearchQuery(searchQuery)}
                  >
                    {t('actions.retry')}
                  </Button>
                </div>
              )}
              
              {searchResults.length > 0 ? (
                <FileSearchResults
                  results={searchResults}
                  searchQuery={searchQuery}
                  onFileSelect={handleSearchResultSelect}
                  onFolderNavigate={handleSearchFolderNavigate}
                  workspacePath={workspacePath}
                  className="sparo-files-panel__search-results"
                />
              ) : (
                !isSearching && !searchError && (
                  <div className="sparo-files-panel__placeholder">
                    <div className="sparo-files-panel__placeholder-icon">
                      <SearchIcon size={32} />
                    </div>
                    <p>{t('search.noResults')}</p>
                  </div>
                )
              )}
            </div>
          ) : (
            <div className="sparo-files-panel__placeholder">
              <div className="sparo-files-panel__placeholder-icon">
                <SearchIcon size={32} />
              </div>
              <p>{t('search.enterKeyword')}</p>
            </div>
          )
        ) : (
          loading && fileTree.length === 0 ? (
            <div className="sparo-files-panel__loading">
              <CubeLoading size="medium" text={t('status.loadingFileTree')} />
            </div>
          ) : error ? (
            <div className="sparo-files-panel__error">
              <p>{error}</p>
              <Button
                variant="ghost"
                size="small"
                onClick={() => loadFileTree()}
              >
                {t('actions.retry')}
              </Button>
            </div>
          ) : (
            <FileExplorer
              key={workspacePath || 'no-workspace'}
              fileTree={fileTree}
              selectedFile={selectedFile}
              expandedFolders={expandedFolders}
              loadingPaths={loadingPaths}
              onNodeExpand={handleNodeExpandLazy}
              onFileSelect={handleFileSelect}
              className="sparo-files-panel__explorer"
              renamingPath={renamingPath}
              onRename={handleExecuteRename}
              onCancelRename={handleCancelRename}
              onMoveToDirectory={handleMoveToDirectory}
              workspacePath={workspacePath}
              onNewFile={handleNewFile}
              onNewFolder={handleNewFolder}
              onRefresh={() => loadFileTree(workspacePath || '', false)}
              hideToolbar={hideExplorerToolbar}
            />
          )
        )}
        </div>
      </div>

      {transferProgress && (
        <div className="sparo-files-panel__transfer" role="status">
          <div className="sparo-files-panel__transfer-label">
            {transferProgress.phase === 'download'
              ? t('transfer.downloading')
              : t('transfer.uploading')}
            {transferProgress.label ? ` — ${transferProgress.label}` : ''}
          </div>
          <div
            className={`sparo-files-panel__transfer-track${
              transferProgress.indeterminate ? ' sparo-files-panel__transfer-track--indeterminate' : ''
            }`}
          >
            <div
              className="sparo-files-panel__transfer-fill"
              style={
                transferProgress.indeterminate || !transferProgress.total
                  ? undefined
                  : {
                      width: `${Math.min(
                        100,
                        Math.round((100 * transferProgress.current) / transferProgress.total)
                      )}%`,
                    }
              }
            />
          </div>
        </div>
      )}

      <InputDialog
        open={inputDialog.isOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            handleInputDialogClose();
          }
        }}
        onConfirm={handleInputDialogConfirm}
        title={inputDialog.type === 'newFile' ? t('dialog.newFile.title') : t('dialog.newFolder.title')}
        placeholder={inputDialog.type === 'newFile' ? t('dialog.newFile.placeholder') : t('dialog.newFolder.placeholder')}
        confirmText={inputDialog.type === 'newFile' ? t('dialog.newFile.confirm') : t('dialog.newFolder.confirm')}
        cancelText={inputDialog.type === 'newFile' ? t('dialog.newFile.cancel') : t('dialog.newFolder.cancel')}
        validator={(value) => {
          // eslint-disable-next-line no-control-regex -- Windows filename rules explicitly forbid ASCII control characters.
          if (!/^[^<>:"/\\|?*\x00-\x1F]+$/.test(value)) {
            return t('validation.invalidFilename');
          }
          return null;
        }}
      />
    </div>
  );
};

export default FilesPanel;
