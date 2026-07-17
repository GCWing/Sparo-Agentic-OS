import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  AppWindow,
  FileText,
  MoreHorizontal,
  Palette,
  Play,
  Settings,
} from 'lucide-react';
import { DropdownMenu, IconButton } from '@/design-system';
import type { DropdownMenuEntry } from '@/design-system';
import type { SessionSidecarIconId } from '@/app/session-profiles';
import type { FlowChatSidecarActionViewModel } from './useSessionSidecarActions';
import { useTranslation } from 'react-i18next';

interface FlowChatSidecarActionsProps {
  actions: FlowChatSidecarActionViewModel[];
}

const INLINE_ACTION_LIMIT = 4;

function renderIcon(icon: SessionSidecarIconId): React.ReactNode {
  switch (icon) {
    case 'activity':
      return <Activity size={14} />;
    case 'app-window':
      return <AppWindow size={14} />;
    case 'file-text':
      return <FileText size={14} />;
    case 'palette':
      return <Palette size={14} />;
    case 'play':
      return <Play size={14} />;
    case 'settings':
      return <Settings size={14} />;
    default:
      return <AppWindow size={14} />;
  }
}

export const FlowChatSidecarActions: React.FC<FlowChatSidecarActionsProps> = ({
  actions,
}) => {
  const { t } = useTranslation('flow-chat');
  const visibleActions = actions;
  const inlineActions = visibleActions.slice(0, INLINE_ACTION_LIMIT);
  const overflowActions = visibleActions.slice(INLINE_ACTION_LIMIT);
  const overflowAnchorRef = useRef<HTMLDivElement | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const groupLabel = t('flowChatHeader.sidecar.groupLabel', {
    defaultValue: 'Session panels',
  });
  const moreLabel = t('flowChatHeader.sidecar.more', {
    defaultValue: 'More panels',
  });

  const overflowItems = useMemo<DropdownMenuEntry[]>(
    () =>
      overflowActions.map(action => ({
        type: 'item',
        id: action.id,
        label: action.label,
        disabled: action.disabled,
        checked: action.isActive,
        onClick: action.onOpen,
      })),
    [overflowActions],
  );

  if (visibleActions.length === 0) {
    return null;
  }

  return (
    <div className="flowchat-header__sidecar-actions" aria-label={groupLabel}>
      {inlineActions.map(action => (
        <IconButton
          key={action.id}
          className={[
            'flowchat-header__sidecar-action',
            action.isOpen && 'flowchat-header__sidecar-action--open',
            action.isActive && 'flowchat-header__sidecar-action--active',
          ].filter(Boolean).join(' ')}
          variant="ghost"
          size="xs"
          onClick={action.onOpen}
          disabled={action.disabled}
          tooltip={action.label}
          aria-label={action.label}
          aria-pressed={action.isActive}
          data-testid={`flowchat-sidecar-action-${action.id}`}
        >
          {renderIcon(action.icon)}
        </IconButton>
      ))}

      {overflowActions.length > 0 ? (
        <div className="flowchat-header__sidecar-more-wrap" ref={overflowAnchorRef}>
          <IconButton
            className="flowchat-header__sidecar-more"
            variant="ghost"
            size="xs"
            onClick={() => setOverflowOpen(value => !value)}
            tooltip={moreLabel}
            aria-label={moreLabel}
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
          >
            <MoreHorizontal size={14} />
          </IconButton>
          <DropdownMenu
            open={overflowOpen}
            anchorRef={overflowAnchorRef}
            items={overflowItems}
            onClose={() => setOverflowOpen(false)}
            align="right"
            minWidth={180}
          />
        </div>
      ) : null}
    </div>
  );
};

FlowChatSidecarActions.displayName = 'FlowChatSidecarActions';
