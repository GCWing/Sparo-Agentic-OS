import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  ChevronDown,
  Check,
  RefreshCw,
  Play,
  Pencil,
  Square,
  Trash2,
} from 'lucide-react';
import { useI18n } from '@/infrastructure/i18n';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import type { TerminalConfig } from '@/infrastructure/config/types';
import TerminalEditModal from '@/app/components/panels/TerminalEditModal';
import { useContextMenuStore } from '@/shared/context-menu-system';
import { ContextType } from '@/shared/context-menu-system/types/context.types';
import type { MenuItem } from '@/shared/context-menu-system/types/menu.types';
import { useWorkspaceSurfaceStore } from '@/app/navigation/workspaceSurfaceStore';
import { useTerminalSceneStore } from '@/app/stores/terminalSceneStore';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';
import { projectRuntimeScopeFromWorkspace } from '@/shared/types/runtime-scope';
import { useMovingHoverHighlight } from '@/shared/hooks/useMovingHoverHighlight';
import { isSamePath } from '@/shared/utils/pathUtils';
import { getTerminalService } from '@/tools/terminal';
import type { ShellInfo } from '@/tools/terminal';
import { useShellStore } from './shellStore';
import { useShellEntries } from './hooks';
import { MANUAL_SOURCE, type ShellEntry } from './hooks/shellEntryTypes';
import type { ShellNavFilter } from './shellConfig';
import { useShellNavMenuState } from './hooks/useShellNavMenuState';
import { Button, IconButton, NavigationListItem } from '@/design-system';
import ShellNavEntryItem from './components/ShellNavEntryItem';
import ShellNavWorkspaceSwitcher from './components/ShellNavWorkspaceSwitcher';
import './ShellNav.scss';

function extractShortVersion(version?: string): string {
  if (!version) return '';
  const match = version.match(/\d+(?:\.\d+){1,2}/);
  return match ? match[0] : '';
}

function formatShellMenuLabel(shell: ShellInfo, isDefault: boolean, defaultBadgeLabel: string): string {
  const shortVersion = extractShortVersion(shell.version);
  const base = shortVersion ? `${shell.name} ${shortVersion}` : shell.name;
  return isDefault ? `${base} · ${defaultBadgeLabel}` : base;
}

type ShellNavView = 'all' | ShellNavFilter;

function resolveShellNavView(manualActive: boolean, agentActive: boolean): ShellNavView {
  if (manualActive && agentActive) return 'all';
  if (manualActive) return 'manual';
  return 'agent';
}

interface ShellNavProps {
  workspacePath?: string;
}

const ShellNav: React.FC<ShellNavProps> = ({ workspacePath }) => {
  const { t: tNav } = useI18n('shell/navigation');
  const { t: tHeader } = useI18n('shell/header');
  const { lastUsedWorkspace, openedWorkspacesList, workspaceName } = useWorkspaceContext();
  const activeFilters = useShellStore((s) => s.activeFilters);
  const setActiveFilters = useShellStore((s) => s.setActiveFilters);
  const activeSurface = useWorkspaceSurfaceStore((s) => s.activeSurface);
  const activeSceneId = activeSurface.kind === 'scene' ? activeSurface.sceneId : 'session';
  const activeTerminalSessionId = useTerminalSceneStore((s) => s.activeSessionId);
  const showMenu = useContextMenuStore((s) => s.showMenu);
  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);
  const [defaultShellType, setDefaultShellType] = useState<string>('');
  const createMenuHover = useMovingHoverHighlight<HTMLDivElement>();
  const filterMenuHover = useMovingHoverHighlight<HTMLDivElement>();
  const terminalHover = useMovingHoverHighlight<HTMLDivElement>();

  const {
    manualEntries,
    agentEntries,
    editModalOpen,
    editingTerminal,
    closeEditModal,
    refresh: refreshEntries,
    createManualTerminal,
    openEntry,
    stopEntry,
    deleteEntry,
    openEditModal,
    saveEdit,
  } = useShellEntries(workspacePath);

  const manualFilterActive = activeFilters.includes('manual');
  const agentFilterActive = activeFilters.includes('agent');
  const hasAllFilters = manualFilterActive && agentFilterActive;
  const activeView = resolveShellNavView(manualFilterActive, agentFilterActive);

  const handleViewChange = useCallback((view: ShellNavView) => {
    if (view === 'all') {
      setActiveFilters(['manual', 'agent']);
      return;
    }
    setActiveFilters([view]);
  }, [setActiveFilters]);

  const handleSelectView = useCallback((view: ShellNavView) => {
    handleViewChange(view);
  }, [handleViewChange]);

  const viewSwitchOptions = useMemo(() => ([
    { value: 'all', label: tNav('shell.views.all') },
    { value: 'manual', label: tNav('shell.views.manual') },
    { value: 'agent', label: tNav('shell.views.agent') },
  ]), [tNav]);

  const visibleSections = useMemo(() => {
    const sections = [];

    if (manualFilterActive) {
      sections.push({
        key: 'manual',
        label: tNav('shell.views.manual'),
        entries: manualEntries,
      });
    }

    if (agentFilterActive) {
      sections.push({
        key: 'agent',
        label: tNav('shell.views.agent'),
        entries: agentEntries,
      });
    }

    return sections;
  }, [agentEntries, agentFilterActive, manualEntries, manualFilterActive, tNav]);
  const visibleEntryCount = useMemo(
    () => visibleSections.reduce((sum, section) => sum + section.entries.length, 0),
    [visibleSections],
  );
  const scopedWorkspace = useMemo(() => {
    if (!workspacePath) {
      return lastUsedWorkspace;
    }
    return openedWorkspacesList.find(workspace => isSamePath(workspace.rootPath, workspacePath)) ?? null;
  }, [lastUsedWorkspace, openedWorkspacesList, workspacePath]);
  const scopedWorkspaceName = scopedWorkspace?.name ?? (workspacePath ? '' : workspaceName);
  const scopedWorkspaceId = scopedWorkspace?.id ?? null;
  const hasMultipleWorkspaces = openedWorkspacesList.length > 1;
  const hasVisibleContent = visibleEntryCount > 0;
  const {
    menuOpen,
    setMenuOpen,
    workspaceMenuOpen,
    setWorkspaceMenuOpen,
    workspaceMenuPosition,
    filterMenuOpen,
    setFilterMenuOpen,
    menuRef,
    workspaceMenuRef,
    workspaceTriggerRef,
    filterMenuRef,
    filterTriggerRef,
  } = useShellNavMenuState(hasMultipleWorkspaces);

  const loadAvailableShells = useCallback(async () => {
    try {
      const [shells, terminalConfig] = await Promise.all([
        getTerminalService().getAvailableShells(),
        configManager.getSetting<TerminalConfig>('core.terminal'),
      ]);
      setAvailableShells(shells.filter((shell) => shell.available));
      setDefaultShellType(terminalConfig?.default_shell || '');
    } catch {
      setAvailableShells([]);
      setDefaultShellType('');
    }
  }, []);

  useEffect(() => {
    void loadAvailableShells();
  }, [loadAvailableShells]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      refreshEntries(),
      loadAvailableShells(),
    ]);
  }, [loadAvailableShells, refreshEntries]);

  const handleCreateManualTerminal = useCallback(async (shellType?: string) => {
    setMenuOpen(false);
    await createManualTerminal(shellType);
  }, [createManualTerminal, setMenuOpen]);

  const handleToggleCreateMenu = useCallback(() => {
    setWorkspaceMenuOpen(false);
    setFilterMenuOpen(false);
    setMenuOpen((prev) => !prev);
  }, [setFilterMenuOpen, setMenuOpen, setWorkspaceMenuOpen]);

  const shellMenuItems = useMemo(
    () =>
      availableShells.map((shell) => ({
        key: shell.shellType,
        label: formatShellMenuLabel(
          shell,
          shell.shellType === defaultShellType,
          tNav('shell.badges.default'),
        ),
        shellType: shell.shellType,
      })),
    [availableShells, defaultShellType, tNav],
  );

  const handleToggleWorkspaceMenu = useCallback(() => {
    if (!hasMultipleWorkspaces) {
      return;
    }

    setMenuOpen(false);
    setFilterMenuOpen(false);
    setWorkspaceMenuOpen((prev) => !prev);
  }, [hasMultipleWorkspaces, setFilterMenuOpen, setMenuOpen, setWorkspaceMenuOpen]);

  const handleToggleFilterMenu = useCallback(() => {
    setMenuOpen(false);
    setWorkspaceMenuOpen(false);
    setFilterMenuOpen((prev) => !prev);
  }, [setFilterMenuOpen, setMenuOpen, setWorkspaceMenuOpen]);

  const handleViewMenuSelect = useCallback((view: ShellNavView) => {
    handleSelectView(view);
    setFilterMenuOpen(false);
  }, [handleSelectView, setFilterMenuOpen]);

  const handleSelectWorkspace = useCallback(async (workspaceId: string) => {
    setWorkspaceMenuOpen(false);
    if (workspaceId === scopedWorkspaceId) {
      return;
    }
    const workspace = openedWorkspacesList.find(candidate => candidate.id === workspaceId);
    const scope = projectRuntimeScopeFromWorkspace(workspace);
    if (!scope) {
      return;
    }
    openWorkspaceScene('shell', { scope });
  }, [openedWorkspacesList, scopedWorkspaceId, setWorkspaceMenuOpen]);

  const openContextMenu = useCallback((
    event: React.MouseEvent<HTMLElement>,
    items: MenuItem[],
    data: Record<string, unknown>,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    showMenu(
      { x: event.clientX, y: event.clientY },
      items,
      {
        type: ContextType.CUSTOM,
        customType: 'shell-nav',
        data,
        event,
        targetElement: event.currentTarget,
        position: { x: event.clientX, y: event.clientY },
        timestamp: Date.now(),
      },
    );
  }, [showMenu]);

  const getEntryMenuItems = useCallback((entry: ShellEntry): MenuItem[] => {
    if (entry.kind === 'manual-profile') {
      return [
        !entry.isRunning
          ? {
              id: `start-${entry.sessionId}`,
              label: tNav('shell.context.start'),
              icon: <Play size={14} />,
              onClick: async () => {
                await openEntry(entry);
              },
            }
          : {
              id: `stop-${entry.sessionId}`,
              label: tNav('shell.context.stop'),
              icon: <Square size={14} />,
              onClick: async () => {
                await stopEntry(entry);
              },
            },
        {
          id: `edit-${entry.sessionId}`,
          label: tNav('shell.context.editConfig'),
          icon: <Pencil size={14} />,
          onClick: () => {
            openEditModal(entry);
          },
        },
        {
          id: `delete-${entry.sessionId}`,
          label: tNav('shell.context.deleteSavedTerminal'),
          icon: <Trash2 size={14} />,
          onClick: async () => {
            await deleteEntry(entry);
          },
        },
      ];
    }

    if (entry.kind === 'agent-session') {
      return [];
    }

    return [{
        id: `config-${entry.sessionId}`,
        label: tNav('shell.context.saveConfig'),
        icon: <Pencil size={14} />,
        onClick: () => {
          openEditModal(entry);
        },
      }];
  }, [deleteEntry, openEditModal, openEntry, stopEntry, tNav]);

  const getQuickAction = useCallback((entry: ShellEntry) => {
    if (entry.isRunning) {
      return {
        icon: <Trash2 size={12} />,
        title: tNav('shell.context.close'),
        onClick: () => { void deleteEntry(entry); },
      };
    }

    if (entry.isPersisted) {
      return {
        icon: <Trash2 size={12} />,
        title: tNav('shell.context.deleteSavedTerminal'),
        onClick: () => { void deleteEntry(entry); },
      };
    }

    return {
      icon: <Trash2 size={12} />,
      title: tNav('shell.context.close'),
      onClick: () => { void deleteEntry(entry); },
    };
  }, [deleteEntry, tNav]);

  return (
    <div className="sparo-shell-nav">
      <div className="sparo-shell-nav__header">
        <div className="sparo-shell-nav__header-main">
          <span className="sparo-shell-nav__title">{tNav('shell.title')}</span>
          <ShellNavWorkspaceSwitcher
            workspaceName={scopedWorkspaceName}
            hasMultipleWorkspaces={hasMultipleWorkspaces}
            workspaceMenuOpen={workspaceMenuOpen}
            workspaceMenuPosition={workspaceMenuPosition}
            openedWorkspacesList={openedWorkspacesList}
            lastUsedWorkspaceId={scopedWorkspaceId ?? undefined}
            workspaceMenuRef={workspaceMenuRef}
            workspaceTriggerRef={workspaceTriggerRef}
            switchWorkspaceLabel={tHeader('switchWorkspace')}
            onToggle={handleToggleWorkspaceMenu}
            onSelectWorkspace={handleSelectWorkspace}
          />
        </div>
        <div className="sparo-shell-nav__view-filter-wrap" ref={filterMenuRef}>
          <Button
            ref={filterTriggerRef}
            type="button"
            variant="ghost"
            size="small"
            className={`sparo-shell-nav__view-trigger${filterMenuOpen ? ' is-active' : ''}`}
            onClick={handleToggleFilterMenu}
            aria-haspopup="menu"
            aria-expanded={filterMenuOpen}
            aria-label={tNav('shell.filters.label')}
          >
            <span className="sparo-shell-nav__view-trigger-label">
              {viewSwitchOptions.find((option) => option.value === activeView)?.label}
            </span>
            <ChevronDown size={12} className="sparo-shell-nav__view-trigger-icon" />
          </Button>

          {filterMenuOpen ? (
            <div
              ref={filterMenuHover.surfaceRef}
              className="sparo-shell-nav__view-menu sparo-shell-nav__view-menu--motion"
              role="menu"
              aria-label={tNav('shell.filters.label')}
              {...filterMenuHover.getSurfaceHandlers('.sparo-shell-nav__view-menu-entry')}
            >
              <div
                className="sparo-shell-nav__menu-hover-highlight"
                style={{
                  transform: `translate3d(${filterMenuHover.highlight.left}px, ${filterMenuHover.highlight.top}px, 0) scale(${filterMenuHover.highlight.stretchX}, ${filterMenuHover.highlight.stretchY})`,
                  width: `${filterMenuHover.highlight.width}px`,
                  height: `${filterMenuHover.highlight.height}px`,
                  opacity: filterMenuHover.highlight.visible ? 1 : 0,
                }}
              />
              {viewSwitchOptions.map((option) => {
                const isActive = option.value === activeView;

                return (
                  <NavigationListItem
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    icon={(
                      <span className="sparo-shell-nav__view-menu-check" aria-hidden="true">
                        {isActive ? <Check size={12} /> : null}
                      </span>
                    )}
                    className={`sparo-shell-nav__view-menu-entry${isActive ? ' is-active' : ''}`}
                    onClick={() => handleViewMenuSelect(option.value as ShellNavView)}
                  >
                    <span className="sparo-shell-nav__view-menu-text">{option.label}</span>
                  </NavigationListItem>
                );
              })}
            </div>
          ) : null}
        </div>
        <div className="sparo-shell-nav__header-actions" ref={menuRef}>
          <div className={`sparo-shell-nav__split-button${menuOpen ? ' is-active' : ''}`}>
            <IconButton
              aria-label={tNav('shell.actions.newTerminal')}
              tooltip={tNav('shell.actions.newTerminal')}
              tooltipPlacement="bottom"
              size="xs"
              variant="ghost"
              className="sparo-shell-nav__split-button-main"
              onClick={() => { void handleCreateManualTerminal(); }}
            >
              <Plus size={14} />
            </IconButton>
            <IconButton
              aria-label={tNav('actions.more')}
              tooltip={tNav('actions.more')}
              tooltipPlacement="bottom"
              size="xs"
              variant="ghost"
              className="sparo-shell-nav__split-button-toggle"
              onClick={handleToggleCreateMenu}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <ChevronDown size={12} />
            </IconButton>
          </div>

          {menuOpen ? (
            <div
              ref={createMenuHover.surfaceRef}
              className="sparo-shell-nav__dropdown-menu sparo-shell-nav__dropdown-menu--motion"
              role="menu"
              {...createMenuHover.getSurfaceHandlers('.sparo-shell-nav__dropdown-entry')}
            >
              <div
                className="sparo-shell-nav__dropdown-hover-highlight"
                style={{
                  transform: `translate3d(${createMenuHover.highlight.left}px, ${createMenuHover.highlight.top}px, 0) scale(${createMenuHover.highlight.stretchX}, ${createMenuHover.highlight.stretchY})`,
                  width: `${createMenuHover.highlight.width}px`,
                  height: `${createMenuHover.highlight.height}px`,
                  opacity: createMenuHover.highlight.visible ? 1 : 0,
                }}
              />
              {shellMenuItems.map((shell) => (
                <NavigationListItem
                  key={shell.key}
                  className="sparo-shell-nav__dropdown-entry"
                  icon={<Plus size={14} />}
                  role="menuitem"
                  onClick={() => { void handleCreateManualTerminal(shell.shellType); }}
                >
                  {shell.label}
                </NavigationListItem>
              ))}
              {shellMenuItems.length > 0 ? <div className="sparo-shell-nav__dropdown-separator" /> : null}
              <NavigationListItem
                className="sparo-shell-nav__dropdown-entry"
                icon={<RefreshCw size={14} />}
                role="menuitem"
                onClick={() => { setMenuOpen(false); void handleRefresh(); }}
              >
                {tNav('shell.actions.refresh')}
              </NavigationListItem>
            </div>
          ) : null}
        </div>
      </div>

      <div
        className={`sparo-shell-nav__sections${!hasVisibleContent ? ' sparo-shell-nav__sections--empty' : ''}`}
      >
        {hasVisibleContent ? (
          <div
            ref={terminalHover.surfaceRef}
            className="sparo-shell-nav__section-list sparo-shell-nav__section-list--motion"
            {...terminalHover.getSurfaceHandlers('.sparo-shell-nav__terminal-item')}
          >
            <div
              className="sparo-shell-nav__terminal-hover-highlight"
              style={{
                transform: `translate3d(${terminalHover.highlight.left}px, ${terminalHover.highlight.top}px, 0) scale(${terminalHover.highlight.stretchX}, ${terminalHover.highlight.stretchY})`,
                width: `${terminalHover.highlight.width}px`,
                height: `${terminalHover.highlight.height}px`,
                opacity: terminalHover.highlight.visible ? 1 : 0,
              }}
            />
            {visibleSections.map((section) => (
              <section key={section.key} className="sparo-shell-nav__section">
                {activeView === 'all' ? (
                  <div className="sparo-shell-nav__section-header">
                    <span className="sparo-shell-nav__section-title">{section.label}</span>
                    <span className="sparo-shell-nav__section-count">{section.entries.length}</span>
                  </div>
                ) : null}
                {section.entries.length > 0 ? (
                  <div className="sparo-shell-nav__terminal-list">
                    {section.entries.map((entry) => (
                      <ShellNavEntryItem
                        key={entry.sessionId}
                        entry={entry}
                        isActive={activeSceneId === 'shell' && activeTerminalSessionId === entry.sessionId}
                        showSavedBadge={entry.source === MANUAL_SOURCE && entry.isPersisted}
                        startupCommandBadgeLabel={tNav('shell.badges.startupCommand')}
                        savedBadgeLabel={tNav('shell.badges.saved')}
                        quickAction={getQuickAction(entry)}
                        getEntryMenuItems={getEntryMenuItems}
                        onOpen={openEntry}
                        onOpenContextMenu={openContextMenu}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="sparo-shell-nav__section-empty">
                    {section.key === 'agent' ? tNav('shell.empty.agent') : tNav('shell.empty.manual')}
                  </p>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="sparo-shell-nav__empty">
            <p className="sparo-shell-nav__empty-message">
              {hasAllFilters ? tNav('shell.empty.all') : agentFilterActive ? tNav('shell.empty.agent') : tNav('shell.empty.manual')}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={() => { void handleCreateManualTerminal(); }}
            >
              <Plus size={14} aria-hidden />
              {tNav('shell.empty.quickNew')}
            </Button>
          </div>
        )}
      </div>

      {editingTerminal ? (
        <TerminalEditModal
          isOpen={editModalOpen}
          onClose={closeEditModal}
          onSave={saveEdit}
          initialName={editingTerminal.entry.name}
          initialWorkingDirectory={editingTerminal.entry.workingDirectory ?? editingTerminal.entry.cwd ?? ''}
          initialStartupCommand={editingTerminal.entry.startupCommand}
          showWorkingDirectory
          showStartupCommand
        />
      ) : null}
    </div>
  );
};

export default ShellNav;
