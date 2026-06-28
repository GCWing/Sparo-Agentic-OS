import React, { useCallback, useRef, useState } from 'react';
import {
  MoreHorizontal,
  Play,
  Square,
} from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  IconButton,
  StatusDot,
  Tag,
  type DropdownMenuEntry,
} from '@/design-system';
import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import { notificationService } from '@/shared/notification-system';
import { appIconFor } from '../iconUtils';
import './ManagementList.scss';

interface ManagementListProps {
  apps: ProductAppCatalogEntry[];
  launchingAppId: string | null;
  stoppingAppId: string | null;
  runningAppIds: Set<string>;
  onLaunch: (app: ProductAppCatalogEntry) => void;
  onStop: (app: ProductAppCatalogEntry) => void;
  onOpenDetails: (app: ProductAppCatalogEntry) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function ManagementRow({
  app,
  disabled,
  launching,
  stopping,
  running,
  onToggleEnabled,
  onOpenDetails,
  onLaunch,
  onStop,
  onUninstall,
  t,
}: {
  app: ProductAppCatalogEntry;
  disabled: boolean;
  launching: boolean;
  stopping: boolean;
  running: boolean;
  onToggleEnabled: () => void;
  onOpenDetails: () => void;
  onLaunch: () => void;
  onStop: () => void;
  onUninstall: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const moreMenuItems: DropdownMenuEntry[] = [
    {
      type: 'item',
      id: 'details',
      label: t('productSystem.actions.details'),
      onClick: () => { onOpenDetails(); },
    },
    {
      type: 'separator',
      id: 'sep',
    },
    {
      type: 'item',
      id: 'uninstall',
      label: t('productSystem.manage.uninstall'),
      onClick: () => { onUninstall(); },
    },
  ];

  const Icon = appIconFor(app);

  return (
    <div
      className={`management-list__row${disabled ? ' is-disabled' : ''}`}
      role="listitem"
    >
      <div className="management-list__main" onClick={onOpenDetails}>
        <span className="management-list__icon" aria-hidden>
          <Icon size={18} strokeWidth={1.8} />
        </span>
        <div className="management-list__info">
          <div className="management-list__name-row">
            <strong className="management-list__name">{app.name}</strong>
            <StatusDot
              tone={disabled ? 'neutral' : running ? 'success' : 'neutral'}
              size="small"
              pulse={running && !disabled}
            />
          </div>
          <span className="management-list__description">
            {app.goal || app.description}
          </span>
          <div className="management-list__meta">
            <Tag size="small" color="gray">
              {t(`productSystem.installScope.${app.installScope}`)}
            </Tag>
            <span className="management-list__version">{app.version}</span>
          </div>
        </div>
      </div>

      <div className="management-list__actions">
        <Button
          variant="ghost"
          size="small"
          onClick={onToggleEnabled}
          disabled={launching || stopping}
        >
          {disabled
            ? t('productSystem.manage.enable')
            : t('productSystem.manage.disable')}
        </Button>

        {running ? (
          <IconButton
            variant="ghost"
            size="small"
            shape="circle"
            aria-label={t('productSystem.actions.stop')}
            tooltip={t('productSystem.actions.stop')}
            onClick={onStop}
            disabled={stopping}
            aria-busy={stopping || undefined}
          >
            <Square size={14} aria-hidden />
          </IconButton>
        ) : (
          <IconButton
            variant="ghost"
            size="small"
            shape="circle"
            aria-label={t('productSystem.actions.launch')}
            tooltip={t('productSystem.actions.launch')}
            onClick={onLaunch}
            disabled={launching || disabled}
            aria-busy={launching || undefined}
          >
            <Play size={14} aria-hidden />
          </IconButton>
        )}

        <IconButton
          ref={menuAnchorRef}
          variant="ghost"
          size="small"
          shape="circle"
          aria-label={t('productSystem.manage.moreActions')}
          tooltip={t('productSystem.manage.moreActions')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal size={14} aria-hidden />
        </IconButton>
        <DropdownMenu
          open={menuOpen}
          anchorRef={menuAnchorRef}
          items={moreMenuItems}
          onClose={() => setMenuOpen(false)}
          align="right"
          minWidth={180}
        />
      </div>
    </div>
  );
}

export const ManagementList: React.FC<ManagementListProps> = ({
  apps,
  launchingAppId,
  stoppingAppId,
  runningAppIds,
  onLaunch,
  onStop,
  onOpenDetails,
  t,
}) => {
  // Client-side disabled state until backend provides enable/disable API.
  const [disabledAppIds, setDisabledAppIds] = useState<Set<string>>(new Set());
  const [uninstallTarget, setUninstallTarget] = useState<ProductAppCatalogEntry | null>(null);

  const handleToggleEnabled = useCallback((appId: string, appName: string) => {
    setDisabledAppIds((prev) => {
      const next = new Set(prev);
      if (next.has(appId)) {
        next.delete(appId);
        notificationService.success(
          t('productSystem.manage.enabledToast', { name: appName }),
          { duration: 2000 },
        );
      } else {
        next.add(appId);
        notificationService.success(
          t('productSystem.manage.disabledToast', { name: appName }),
          { duration: 2000 },
        );
      }
      return next;
    });
  }, [t]);

  const handleUninstallConfirm = useCallback(() => {
    if (!uninstallTarget) return;
    setDisabledAppIds((prev) => {
      const next = new Set(prev);
      next.add(uninstallTarget.id);
      return next;
    });
    notificationService.success(
      t('productSystem.manage.uninstalledToast', { name: uninstallTarget.name }),
      { duration: 3000 },
    );
    setUninstallTarget(null);
  }, [t, uninstallTarget]);

  return (
    <>
      <ConfirmDialog
        open={uninstallTarget !== null}
        onOpenChange={(open) => { if (!open) setUninstallTarget(null); }}
        onConfirm={handleUninstallConfirm}
        onCancel={() => setUninstallTarget(null)}
        type="error"
        confirmDanger
        title={uninstallTarget ? t('productSystem.manage.uninstallTitle') : ''}
        message={uninstallTarget ? t('productSystem.manage.uninstallMessage', {
          name: uninstallTarget.name,
          scope: t(`productSystem.installScope.${uninstallTarget.installScope}`),
        }) : ''}
        confirmText={t('productSystem.manage.uninstallConfirm')}
        cancelText={t('productSystem.actions.cancel')}
      />
      <div className="management-list" role="list" aria-label={t('productSystem.manage.listLabel')}>
        {apps.map((app) => {
          const isDisabled = disabledAppIds.has(app.id);
          return (
            <ManagementRow
              key={app.id}
              app={app}
              disabled={isDisabled}
              launching={launchingAppId === app.id}
              stopping={stoppingAppId === app.id}
              running={runningAppIds.has(app.id)}
              onToggleEnabled={() => handleToggleEnabled(app.id, app.name)}
              onOpenDetails={() => onOpenDetails(app)}
              onLaunch={() => onLaunch(app)}
              onStop={() => onStop(app)}
              onUninstall={() => setUninstallTarget(app)}
              t={t}
            />
          );
        })}
      </div>
    </>
  );
};

export default ManagementList;
