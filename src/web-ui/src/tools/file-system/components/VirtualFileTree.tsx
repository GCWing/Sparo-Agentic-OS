import React, { useCallback, useMemo, useRef, forwardRef } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { VirtualFileTreeProps, FlatFileNode, FileSystemNode } from '../types';
import { useI18n } from '@/infrastructure/i18n';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import { expandedFoldersContains } from '@/shared/utils/pathUtils';
import { FileTreeItem } from './FileTreeItem';

interface VirtualFileRowProps {
  node: FlatFileNode;
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: (node: FlatFileNode) => void;
  onToggleExpand: (path: string) => void;
  renamingPath?: string | null;
  onRename?: (oldPath: string, newName: string) => void;
  onCancelRename?: () => void;
  onMoveToDirectory?: (sourcePath: string, targetDirectory: string) => void;
  renderContent?: (node: FileSystemNode, level: number) => React.ReactNode;
  renderActions?: (node: FileSystemNode) => React.ReactNode;
}

const VirtualFileRow = React.memo<VirtualFileRowProps>(({
  node,
  isSelected,
  isExpanded,
  onSelect,
  onToggleExpand,
  renamingPath,
  onRename,
  onCancelRename,
  onMoveToDirectory,
  renderContent,
  renderActions,
}) => {
  const indentPx = node.depth * 20 + 16;

  const nodeForIcon: FileSystemNode = useMemo(() => ({
    path: node.path,
    name: node.name,
    isDirectory: node.isDirectory,
    extension: node.extension,
    size: node.size,
    lastModified: node.lastModified,
  }), [node]);

  return (
    <div className="sparo-file-explorer__node">
      <FileTreeItem
        node={nodeForIcon}
        level={node.depth}
        indentPx={indentPx}
        isSelected={isSelected}
        isExpanded={isExpanded}
        isLoading={node.isLoading}
        renamingPath={renamingPath}
        onRename={onRename}
        onCancelRename={onCancelRename}
        onMoveToDirectory={onMoveToDirectory}
        onSelect={() => onSelect(node)}
        onToggleExpand={() => onToggleExpand(node.path)}
        renderContent={renderContent}
        renderActions={renderActions}
      />
    </div>
  );
});

VirtualFileRow.displayName = 'VirtualFileRow';

export const VirtualFileTree = forwardRef<VirtuosoHandle, VirtualFileTreeProps>(({
  flatNodes,
  selectedFile,
  expandedFolders,
  onNodeSelect,
  onToggleExpand,
  height = '100%',
  className = '',
  renamingPath,
  onRename,
  onCancelRename,
  onMoveToDirectory,
  renderNodeContent,
  renderNodeActions,
}, ref) => {
  const { t } = useI18n('tools');
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const itemHover = useMovingHoverHighlight<HTMLDivElement>();

  React.useImperativeHandle(ref, () => virtuosoRef.current!, []);

  const handleNodeSelect = useCallback((node: FlatFileNode) => {
    onNodeSelect?.(node);
  }, [onNodeSelect]);

  const handleToggleExpand = useCallback((path: string) => {
    onToggleExpand?.(path);
  }, [onToggleExpand]);

  const itemContent = useCallback((_index: number, node: FlatFileNode) => {
    const isSelected = selectedFile === node.path;
    const isExpanded = expandedFoldersContains(expandedFolders, node.path);

    return (
      <VirtualFileRow
        node={node}
        isSelected={isSelected}
        isExpanded={isExpanded}
        onSelect={handleNodeSelect}
        onToggleExpand={handleToggleExpand}
        renamingPath={renamingPath}
        onRename={onRename}
        onCancelRename={onCancelRename}
        onMoveToDirectory={onMoveToDirectory}
        renderContent={renderNodeContent}
        renderActions={renderNodeActions}
      />
    );
  }, [selectedFile, expandedFolders, handleNodeSelect, handleToggleExpand, renamingPath, onRename, onCancelRename, onMoveToDirectory, renderNodeContent, renderNodeActions]);

  if (flatNodes.length === 0) {
    return (
      <div className={`sparo-file-explorer__tree sparo-file-explorer__tree--empty ${className}`}>
        <div className="sparo-file-explorer__empty-message">
          <p>{t('fileTree.empty')}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={itemHover.surfaceRef}
      className={`sparo-file-explorer__tree sparo-file-explorer__tree--virtual sparo-file-explorer__tree--motion ${className}`}
      style={{ height }}
      tabIndex={0}
      {...itemHover.getSurfaceHandlers('.sparo-file-explorer__node-content')}
    >
      <div
        className="sparo-file-explorer__hover-highlight"
        style={{
          transform: `translate3d(${itemHover.highlight.left}px, ${itemHover.highlight.top}px, 0) scale(${itemHover.highlight.stretchX}, ${itemHover.highlight.stretchY})`,
          width: `${itemHover.highlight.width}px`,
          height: `${itemHover.highlight.height}px`,
          opacity: itemHover.highlight.visible ? 1 : 0,
        }}
      />
      <Virtuoso
        ref={virtuosoRef}
        data={flatNodes}
        itemContent={itemContent}
        overscan={50}
        increaseViewportBy={{ top: 100, bottom: 200 }}
        style={{ height: '100%' }}
        computeItemKey={(_index, node) => node.path}
      />
    </div>
  );
});

VirtualFileTree.displayName = 'VirtualFileTree';

export default VirtualFileTree;
