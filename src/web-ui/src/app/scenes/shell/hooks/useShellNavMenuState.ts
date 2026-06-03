import { useCallback, useEffect, useRef, useState } from 'react';

interface MenuPosition {
  top: number;
  left: number;
}

interface UseShellNavMenuStateReturn {
  menuOpen: boolean;
  setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  workspaceMenuOpen: boolean;
  setWorkspaceMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  workspaceMenuPosition: MenuPosition | null;
  filterMenuOpen: boolean;
  setFilterMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  menuRef: React.MutableRefObject<HTMLDivElement | null>;
  workspaceMenuRef: React.MutableRefObject<HTMLDivElement | null>;
  workspaceTriggerRef: React.MutableRefObject<HTMLButtonElement | null>;
  filterMenuRef: React.MutableRefObject<HTMLDivElement | null>;
  filterTriggerRef: React.MutableRefObject<HTMLButtonElement | null>;
}

export function useShellNavMenuState(
  hasMultipleWorkspaces: boolean,
): UseShellNavMenuStateReturn {
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState<MenuPosition | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen && !workspaceMenuOpen && !filterMenuOpen) {
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (menuRef.current?.contains(target) ||
          workspaceMenuRef.current?.contains(target) ||
          workspaceTriggerRef.current?.contains(target) ||
          filterMenuRef.current?.contains(target) ||
          filterTriggerRef.current?.contains(target))
      ) {
        return;
      }

      setMenuOpen(false);
      setWorkspaceMenuOpen(false);
      setFilterMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setWorkspaceMenuOpen(false);
        setFilterMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [filterMenuOpen, menuOpen, workspaceMenuOpen]);

  useEffect(() => {
    if (!hasMultipleWorkspaces && workspaceMenuOpen) {
      setWorkspaceMenuOpen(false);
    }
  }, [hasMultipleWorkspaces, workspaceMenuOpen]);

  const updateWorkspaceMenuPosition = useCallback(() => {
    const trigger = workspaceTriggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const estimatedWidth = 220;
    const maxLeft = window.innerWidth - estimatedWidth - viewportPadding;

    setWorkspaceMenuPosition({
      top: Math.max(viewportPadding, rect.bottom + 6),
      left: Math.max(viewportPadding, Math.min(rect.left, maxLeft)),
    });
  }, []);

  useEffect(() => {
    if (!workspaceMenuOpen) {
      return;
    }

    updateWorkspaceMenuPosition();

    const handleViewportChange = () => updateWorkspaceMenuPosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [updateWorkspaceMenuPosition, workspaceMenuOpen]);

  return {
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
  };
}
