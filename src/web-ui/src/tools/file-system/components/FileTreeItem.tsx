import React, { useEffect, useState } from 'react';
import { ChevronRight, ChevronDown, FolderOpen, FileText } from 'lucide-react';
import { DotMatrixLoader, Input } from '@/design-system';
import { dragManager } from '../../../shared/services/DragManager';
import { fileTreeDragSource } from '../../../shared/context-system/drag-drop/FileTreeDragSource';
import { useI18n } from '@/infrastructure/i18n';
import { FileSystemNode } from '../types';
import { getFileIcon, getFileIconClass } from '../utils/fileIcons';
import { normalizePath, pathsEquivalentFs } from '@/shared/utils/pathUtils';
import type { ContextItem } from '@/shared/types/context';

interface RenameInputProps {
  node: FileSystemNode;
  onRename: (newName: string) => void;
  onCancel?: () => void;
}

function getDraggedFileTreePath(data: ContextItem): string | null {
  switch (data.type) {
    case 'file':
      return data.filePath;
    case 'image':
      return data.imagePath;
    case 'directory':
      return data.directoryPath;
    default:
      return null;
  }
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  const normalizedPath = normalizePath(path).replace(/\/+$/, '');
  const normalizedDirectory = normalizePath(directory).replace(/\/+$/, '');
  const winLike = /^[a-zA-Z]:/.test(normalizedPath) || normalizedPath.startsWith('//');
  const pathKey = winLike ? normalizedPath.toLowerCase() : normalizedPath;
  const directoryKey = winLike ? normalizedDirectory.toLowerCase() : normalizedDirectory;

  return pathKey.startsWith(`${directoryKey}/`);
}

const RenameInput: React.FC<RenameInputProps> = ({ node, onRename, onCancel }) => {
  const [value, setValue] = useState(node.name);

  const stopRenameInputPropagation = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      const input = document.querySelector('.sparo-file-explorer__rename-input-wrapper input') as HTMLInputElement | null;
      if (!input) {
        return;
      }

      input.focus();
      const dotIndex = node.name.lastIndexOf('.');
      if (dotIndex > 0 && !node.isDirectory) {
        input.setSelectionRange(0, dotIndex);
      } else {
        input.select();
      }
    }, 10);

    return () => clearTimeout(timer);
  }, [node.name, node.isDirectory]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const newName = value.trim();
      if (newName && newName !== node.name) {
        onRename(newName);
      } else {
        onCancel?.();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel?.();
    }
  };

  const handleBlur = () => {
    const newName = value.trim();
    if (newName && newName !== node.name) {
      onRename(newName);
    } else {
      onCancel?.();
    }
  };

  return (
    <div
      className="sparo-file-explorer__rename-input-wrapper"
      onClick={stopRenameInputPropagation}
      onDoubleClick={stopRenameInputPropagation}
      onMouseDown={stopRenameInputPropagation}
      onPointerDown={stopRenameInputPropagation}
      onDragStart={stopRenameInputPropagation}
    >
      <Input
        type="text"
        variant="filled"
        inputSize="small"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        prefix={node.isDirectory ? <FolderOpen size={14} /> : <FileText size={14} />}
        autoFocus
      />
    </div>
  );
};

export interface FileTreeItemProps {
  node: FileSystemNode;
  level: number;
  indentPx: number;
  isSelected?: boolean;
  isExpanded?: boolean;
  isLoading?: boolean;
  className?: string;
  renamingPath?: string | null;
  onRename?: (path: string, newName: string) => void;
  onCancelRename?: () => void;
  onSelect?: () => void;
  onToggleExpand?: () => void;
  onMoveToDirectory?: (sourcePath: string, targetDirectory: string) => void;
  renderContent?: (node: FileSystemNode, level: number) => React.ReactNode;
  renderActions?: (node: FileSystemNode) => React.ReactNode;
}

export const FileTreeItem: React.FC<FileTreeItemProps> = ({
  node,
  level,
  indentPx,
  isSelected = false,
  isExpanded = false,
  isLoading = false,
  className = '',
  renamingPath,
  onRename,
  onCancelRename,
  onSelect,
  onToggleExpand,
  onMoveToDirectory,
  renderContent,
  renderActions,
}) => {
  const { t } = useI18n('tools');
  const dragImageRef = React.useRef<HTMLDivElement | null>(null);
  const [isDirectoryDragOver, setIsDirectoryDragOver] = React.useState(false);

  const isRenaming = renamingPath === node.path;

  const getAcceptedMoveSourcePath = React.useCallback((): string | null => {
    if (!node.isDirectory || !onMoveToDirectory) {
      return null;
    }

    const payload = dragManager.getCurrentPayload();
    if (!payload || payload.sourceType !== 'file-tree') {
      return null;
    }

    const sourcePath = getDraggedFileTreePath(payload.data);
    if (!sourcePath || pathsEquivalentFs(sourcePath, node.path)) {
      return null;
    }

    if (payload.data.type === 'directory' && isPathInsideDirectory(node.path, sourcePath)) {
      return null;
    }

    return sourcePath;
  }, [node.isDirectory, node.path, onMoveToDirectory]);

  const handleClick = (event: React.MouseEvent) => {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();

    const target = event.currentTarget as HTMLElement;
    if (typeof target.focus === 'function') {
      target.focus();
    }

    if (node.isDirectory) {
      onToggleExpand?.();
    }
    onSelect?.();
  };

  const handleExpandClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onToggleExpand?.();
  };

  const handleContextMenu = () => {
    onSelect?.();
  };

  const handleDragStart = (event: React.DragEvent) => {
    if (isRenaming) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const dragImage = document.createElement('div');
    dragImage.textContent = t('fileTree.draggingFile', { name: node.name });
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    dragImage.style.left = '-1000px';
    dragImage.style.maxWidth = '280px';
    dragImage.style.padding = '6px 10px';
    dragImage.style.background = 'var(--ds-color-bg-panel, #ffffff)';
    dragImage.style.backgroundClip = 'padding-box';
    dragImage.style.color = 'var(--ds-color-text-primary)';
    dragImage.style.border = '1px solid var(--ds-color-border-subtle)';
    dragImage.style.borderRadius = '8px';
    dragImage.style.boxShadow = 'var(--ds-shadow-md, 0 8px 24px color-mix(in srgb, var(--ds-color-text-primary) 14%, transparent))';
    dragImage.style.fontSize = '12px';
    dragImage.style.fontWeight = '500';
    dragImage.style.lineHeight = '18px';
    dragImage.style.whiteSpace = 'nowrap';
    dragImage.style.overflow = 'hidden';
    dragImage.style.textOverflow = 'ellipsis';
    document.body.appendChild(dragImage);
    dragImageRef.current = dragImage;

    event.dataTransfer.setDragImage(dragImage, 0, 0);
    event.dataTransfer.effectAllowed = 'copy';

    const payload = fileTreeDragSource.createPayload(node);
    dragManager.startDrag(fileTreeDragSource, payload, event.nativeEvent);
    event.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleDragEnd = (event: React.DragEvent) => {
    setIsDirectoryDragOver(false);

    if (dragImageRef.current && document.body.contains(dragImageRef.current)) {
      document.body.removeChild(dragImageRef.current);
      dragImageRef.current = null;
    }

    const success = event.nativeEvent.dataTransfer?.dropEffect !== 'none';
    dragManager.endDrag(event.nativeEvent, success);
  };

  const handleDragEnter = (event: React.DragEvent) => {
    const sourcePath = getAcceptedMoveSourcePath();
    if (!sourcePath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsDirectoryDragOver(true);
  };

  const handleDragOver = (event: React.DragEvent) => {
    const sourcePath = getAcceptedMoveSourcePath();
    if (!sourcePath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setIsDirectoryDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsDirectoryDragOver(false);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    const sourcePath = getAcceptedMoveSourcePath();
    if (!sourcePath) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setIsDirectoryDragOver(false);
    onMoveToDirectory?.(sourcePath, node.path);
  };

  return (
    <div
      className={`sparo-file-explorer__node-content ${isSelected ? 'sparo-file-explorer__node-content--selected' : ''} ${node.isDirectory ? 'sparo-file-explorer__node-content--directory' : ''} ${isDirectoryDragOver ? 'sparo-file-explorer__node-content--drop-target' : ''} ${className}`}
      style={{ paddingLeft: `${indentPx}px` }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title={node.path}
      draggable={!isRenaming}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-file-path={node.path}
      data-file={node.isDirectory ? undefined : 'true'}
      data-is-directory={node.isDirectory}
      data-is-expanded={node.isDirectory ? isExpanded : undefined}
      data-selected={isSelected ? 'true' : undefined}
      tabIndex={0}
      role="treeitem"
      aria-selected={isSelected}
    >
      {node.isDirectory ? (
        <span className={`sparo-file-explorer__expand-icon ${isExpanded ? 'sparo-file-explorer__expand-icon--expanded' : ''}`} onClick={handleExpandClick}>
          {isLoading ? (
            <DotMatrixLoader size="tiny" className="sparo-file-explorer__loading-icon" />
          ) : isExpanded ? (
            <ChevronDown size={16} />
          ) : (
            <ChevronRight size={16} />
          )}
        </span>
      ) : (
        <span className={getFileIconClass(node, isExpanded)}>
          {getFileIcon(node, isExpanded)}
        </span>
      )}

      {isRenaming ? (
        <RenameInput
          node={node}
          onRename={(newName) => onRename?.(node.path, newName)}
          onCancel={onCancelRename}
        />
      ) : renderContent ? (
        renderContent(node, level)
      ) : (
        <span className="sparo-file-explorer__node-name">
          {node.name}
        </span>
      )}

      {renderActions ? (
        <div className="sparo-file-explorer__node-actions" onClick={(event) => event.stopPropagation()}>
          {renderActions(node)}
        </div>
      ) : null}
    </div>
  );
};

export default FileTreeItem;
