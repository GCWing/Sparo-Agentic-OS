import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  ChevronDown,
  RefreshCw,
  Play,
  Pencil,
  Square,
  Trash2,
  FileTerminal,
  Bot,
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
import { getTerminalService } from '@/tools/terminal';
import type { ShellInfo } from '@/tools/terminal';
import { useShellStore } from './shellStore';
import { useShellEntries } from './hooks';
import { MANUAL_SOURCE, type ShellEntry } from './hooks/shellEntryTypes';
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

const ShellNav: React.FC = () => {
  const { t: tNav } = useI18n('shell/navigation');
  const { t: tHeader } = useI18n('shell/header');
  const { lastUsedWorkspace, openedWorkspacesList, workspaceName, rememberWorkspace } = useWorkspaceContext();
  const activeFilters = useShellStore((s) => s.activeFilters);
  const setActiveFilters = useShellStore((s) => s.setActiveFilters);
  const toggleFilter = useShellStore((s) => s.toggleFilter);
  const activeSurface = useWorkspaceSurfaceStore((s) => s.activeSurface);
  const activeSceneId = activeSurface.kind === 'scene' ? activeSurface.sceneId : 'session';
  const activeTerminalSessionId = useTerminalSceneStore((s) => s.activeSessionId);
  const showMenu = useContextMenuStore((s) => s.showMenu);
  const [availableShells, setAvailableShells] = useState<ShellInfo[]>([]);
  const [defaultShellType, setDefaultShellType] = useState<string>('');

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
  } = useShellEntries();

  const manualFilterActive = activeFilters.includes('manual');
  const agentFilterActive = activeFilters.includes('agent');
  const hasAllFilters = manualFilterActive && agentFilterActive;
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
  const hasMultipleWorkspaces = openedWorkspacesList.length > 1;
  const hasVisibleContent = visibleEntryCount > 0;
  const {
    menuOpen,
    setMenuOpen,
    workspaceMenuOpen,
    setWorkspaceMenuOpen,
    workspaceMenuPosition,
    menuRef,
    workspaceMenuRef,
    workspaceTriggerRef,
  } = useShellNavMenuState(hasMultipleWorkspaces);

  const loadAvailableShells = useCallback(async () => {
    try {
      const [shells, terminalConfig] = await Promise.all([
        getTerminalService().getAvailableShells(),
        configManager.getConfig<TerminalConfig>('terminal'),
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
    setMenuOpen((prev) => !prev);
  }, [setMenuOpen, setWorkspaceMenuOpen]);

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
    setWorkspaceMenuOpen((prev) => !prev);
  }, [hasMultipleWorkspaces, setMenuOpen, setWorkspaceMenuOpen]);

  const handleSelectWorkspace = useCallback(async (workspaceId: string) => {
    setWorkspaceMenuOpen(false);
    if (workspaceId === lastUsedWorkspace?.id) {
      return;
    }
    await rememberWorkspace(workspaceId);
  }, [lastUsedWorkspace?.id, rememberWorkspace, setWorkspaceMenuOpen]);

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
        <div className="sparo-shell-nav__title-group">
          <span className="sparo-shell-nav__title">{tNav('shell.title')}</span>
          <ShellNavWorkspaceSwitcher
            workspaceName={workspaceName}
            hasMultipleWorkspaces={hasMultipleWorkspaces}
            workspaceMenuOpen={workspaceMenuOpen}
            workspaceMenuPosition={workspaceMenuPosition}
            openedWorkspacesList={openedWorkspacesList}
            lastUsedWorkspaceId={lastUsedWorkspace?.id}
            workspaceMenuRef={workspaceMenuRef}
            workspaceTriggerRef={workspaceTriggerRef}
            switchWorkspaceLabel={tHeader('switchWorkspace')}
            onToggle={handleToggleWorkspaceMenu}
            onSelectWorkspace={handleSelectWorkspace}
          />
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
            <div className="sparo-shell-nav__dropdown-menu" role="menu">
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

      <div className="sparo-shell-nav__filter-bar" role="toolbar" aria-label={tNav('shell.title')}>
        <Button
          type="button"
          size="small"
          variant={hasAllFilters ? 'secondary' : 'ghost'}
          className={`sparo-shell-nav__filter-chip${hasAllFilters ? ' is-active' : ''}`}
          onClick={() => setActiveFilters(['manual', 'agent'])}
          aria-pressed={hasAllFilters}
        >
          <span className="sparo-shell-nav__filter-chip-label">{tNav('shell.views.all')}</span>
          <span className="sparo-shell-nav__filter-chip-count">{manualEntries.length + agentEntries.length}</span>
        </Button>
        <Button
          type="button"
          size="small"
          variant={manualFilterActive ? 'secondary' : 'ghost'}
          className={`sparo-shell-nav__filter-chip${manualFilterActive ? ' is-active' : ''}`}
          onClick={() => toggleFilter('manual')}
          aria-pressed={manualFilterActive}
        >
          <FileTerminal size={14} aria-hidden />
          <span className="sparo-shell-nav__filter-chip-label">{tNav('shell.views.manual')}</span>
          <span className="sparo-shell-nav__filter-chip-count">{manualEntries.length}</span>
        </Button>
        <Button
          type="button"
          size="small"
          variant={agentFilterActive ? 'secondary' : 'ghost'}
          className={`sparo-shell-nav__filter-chip${agentFilterActive ? ' is-active' : ''}`}
          onClick={() => toggleFilter('agent')}
          aria-pressed={agentFilterActive}
        >
          <Bot size={14} aria-hidden />
          <span className="sparo-shell-nav__filter-chip-label">{tNav('shell.views.agent')}</span>
          <span className="sparo-shell-nav__filter-chip-count">{agentEntries.length}</span>
        </Button>
      </div>

      <div
        className={`sparo-shell-nav__sections${!hasVisibleContent ? ' sparo-shell-nav__sections--empty' : ''}`}
      >
        {hasVisibleContent ? (
          <div className="sparo-shell-nav__section-list">
            {visibleSections.map((section) => (
              <section key={section.key} className="sparo-shell-nav__section">
                <div className="sparo-shell-nav__section-header">
                  <span className="sparo-shell-nav__section-title">{section.label}</span>
                  <span className="sparo-shell-nav__section-count">{section.entries.length}</span>
                </div>
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
