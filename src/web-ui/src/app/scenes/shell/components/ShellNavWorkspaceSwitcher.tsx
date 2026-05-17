import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { Button, NavigationListItem, Tooltip } from '@/design-system';
import type { WorkspaceInfo } from '@/shared/types';

interface ShellNavWorkspaceSwitcherProps {
  workspaceName?: string;
  hasMultipleWorkspaces: boolean;
  workspaceMenuOpen: boolean;
  workspaceMenuPosition: { top: number; left: number } | null;
  openedWorkspacesList: WorkspaceInfo[];
  lastUsedWorkspaceId?: string;
  workspaceMenuRef: React.RefObject<HTMLDivElement>;
  workspaceTriggerRef: React.RefObject<HTMLButtonElement>;
  switchWorkspaceLabel: string;
  onToggle: () => void;
  onSelectWorkspace: (workspaceId: string) => Promise<void>;
}

function getWorkspaceDisplayName(workspace: WorkspaceInfo): string {
  return workspace.name;
}

const ShellNavWorkspaceSwitcher: React.FC<ShellNavWorkspaceSwitcherProps> = ({
  workspaceName,
  hasMultipleWorkspaces,
  workspaceMenuOpen,
  workspaceMenuPosition,
  openedWorkspacesList,
  lastUsedWorkspaceId,
  workspaceMenuRef,
  workspaceTriggerRef,
  switchWorkspaceLabel,
  onToggle,
  onSelectWorkspace,
}) => {
  if (!workspaceName) {
    return null;
  }

  return (
    <div className="sparo-shell-nav__workspace-switcher">
      <Tooltip
        content={hasMultipleWorkspaces ? switchWorkspaceLabel : workspaceName}
        placement="bottom"
      >
        <Button
          ref={workspaceTriggerRef}
          type="button"
          variant="ghost"
          size="small"
          className={`sparo-shell-nav__workspace-trigger${workspaceMenuOpen ? ' is-active' : ''}${hasMultipleWorkspaces ? ' is-switchable' : ''}`}
          onClick={onToggle}
          aria-haspopup={hasMultipleWorkspaces ? 'menu' : undefined}
          aria-expanded={hasMultipleWorkspaces ? workspaceMenuOpen : undefined}
        >
          <span className="sparo-shell-nav__workspace-separator">/</span>
          <span className="sparo-shell-nav__workspace-name">{workspaceName}</span>
          {hasMultipleWorkspaces ? (
            <ChevronDown size={12} className="sparo-shell-nav__workspace-trigger-icon" />
          ) : null}
        </Button>
      </Tooltip>

      {workspaceMenuOpen && hasMultipleWorkspaces && workspaceMenuPosition
        ? createPortal(
            <div
              ref={workspaceMenuRef}
              className="sparo-shell-nav__workspace-menu"
              role="menu"
              aria-label={switchWorkspaceLabel}
              style={{
                top: `${workspaceMenuPosition.top}px`,
                left: `${workspaceMenuPosition.left}px`,
              }}
            >
              {openedWorkspacesList.map((workspace) => {
                const isActive = workspace.id === lastUsedWorkspaceId;
                const label = getWorkspaceDisplayName(workspace);

                return (
                  <Tooltip
                    key={workspace.id}
                    content={workspace.rootPath}
                    placement="right"
                    disabled={!workspace.rootPath}
                  >
                    <NavigationListItem
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      icon={(
                        <span className="sparo-shell-nav__workspace-menu-check" aria-hidden="true">
                          {isActive ? <Check size={12} /> : null}
                        </span>
                      )}
                      className={`sparo-shell-nav__workspace-menu-entry${isActive ? ' is-active' : ''}`}
                      onClick={() => { void onSelectWorkspace(workspace.id); }}
                    >
                      <span className="sparo-shell-nav__workspace-menu-text">{label}</span>
                    </NavigationListItem>
                  </Tooltip>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

export default ShellNavWorkspaceSwitcher;
