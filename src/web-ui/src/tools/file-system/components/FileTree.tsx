import React, { useState, useCallback, useMemo } from 'react';
import { FileTreeNode } from './FileTreeNode';
import { FileTreeProps } from '../types';
import { useI18n } from '@/infrastructure/i18n';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import { expandedFoldersContains } from '@/shared/utils/pathUtils';

export const FileTree: React.FC<FileTreeProps> = ({
  nodes,
  selectedFile,
  expandedFolders: externalExpandedFolders,
  loadingPaths,
  onNodeSelect,
  onNodeExpand,
  className = '',
  level = 0,
  workspacePath,
  renderNodeContent,
  renderNodeActions,
  renamingPath,
  onRename,
  onCancelRename,
  onMoveToDirectory,
}) => {
  const { t } = useI18n('tools');
  const [internalExpandedFolders, setInternalExpandedFolders] = useState<Set<string>>(new Set());
  const itemHover = useMovingHoverHighlight<HTMLDivElement>();

  const expandedFolders = externalExpandedFolders || internalExpandedFolders;

  const handleNodeExpand = useCallback((path: string) => {
    if (onNodeExpand) {
      const isCurrentlyExpanded = expandedFoldersContains(expandedFolders, path);
      onNodeExpand(path, !isCurrentlyExpanded);
    } else {
      setInternalExpandedFolders(prev => {
        const newSet = new Set(prev);
        if (newSet.has(path)) {
          newSet.delete(path);
        } else {
          newSet.add(path);
        }
        return newSet;
      });
    }
  }, [expandedFolders, onNodeExpand]);

  const processedNodes = useMemo(() => nodes, [nodes]);

  const renderNodes = (nodeList: FileTreeProps['nodes'], currentLevel: number = level) => {
    return nodeList.map(node => (
      <FileTreeNode
        key={node.path}
        node={node}
        level={currentLevel}
        isSelected={selectedFile === node.path}
        isExpanded={expandedFoldersContains(expandedFolders, node.path)}
        selectedFile={selectedFile}
        expandedFolders={expandedFolders}
        loadingPaths={loadingPaths}
        onSelect={onNodeSelect}
        onToggleExpand={handleNodeExpand}
        renamingPath={renamingPath}
        onRename={onRename}
        onCancelRename={onCancelRename}
        onMoveToDirectory={onMoveToDirectory}
        renderContent={renderNodeContent}
        renderActions={renderNodeActions}
        workspacePath={workspacePath}
      />
    ));
  };

  return (
    <div
      ref={itemHover.surfaceRef}
      className={`sparo-file-explorer__tree sparo-file-explorer__tree--motion ${className}`}
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
      {processedNodes.length > 0 ? (
        renderNodes(processedNodes)
      ) : (
        <div className="sparo-file-explorer__empty-message">
          <p>{t('fileTree.empty')}</p>
        </div>
      )}
    </div>
  );
};

export default FileTree;
