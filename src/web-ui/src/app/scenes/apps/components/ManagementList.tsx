import React, { useCallback, useRef, useState } from 'react';
import {
  Download,
  LayoutGrid,
  List,
  MoreHorizontal,
  RefreshCw,
} from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  DataList,
  DataListItem,
  DropdownMenu,
  EmptyState,
  IconButton,
  ItemCard,
  StatusDot,
  Switch,
  Tag,
  type DropdownMenuEntry,
} from '@/design-system';
import type {
  AppAuthor,
  AppManagementAction,
  ProductAppCatalogEntry,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import { AppIcon } from '../AppIcon';
import './ManagementList.scss';

function shortDigest(value?: string | null): string {
  if (!value) return '-';
  const prefix = value.startsWith('sha256:') ? 'sha256:' : '';
  const body = prefix ? value.slice(prefix.length) : value;
  return `${prefix}${body.slice(0, 12)}`;
}

function formatPublishedAt(value?: number | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString();
}

function updatePreview(app: ProductAppCatalogEntry, t: ManagementListProps['t']): string {
  const lines: string[] = [];
  const releaseTitle = app.catalogReleaseLabel || app.catalogReleaseId;
  if (releaseTitle) {
    lines.push(`${t('productSystem.manage.updatePreviewRelease')}: ${releaseTitle}`);
  }
  if (app.catalogReleaseId) {
    lines.push(`${t('productSystem.manage.updatePreviewReleaseId')}: ${app.catalogReleaseId}`);
  }
  const publishedAt = formatPublishedAt(app.catalogPublishedAtMs);
  if (publishedAt) {
    lines.push(`${t('productSystem.manage.updatePreviewPublished')}: ${publishedAt}`);
  }

  lines.push(
    `${t('productSystem.manage.updatePreviewNotes')}:\n${app.catalogReleaseNotes?.trim()
      || t('productSystem.manage.updatePreviewNoNotes')}`,
  );

  if (app.installedComponentLockDigest || app.availableComponentLockDigest) {
    lines.push(`${t('productSystem.manage.updatePreviewComponentLock')}: ${
      shortDigest(app.installedComponentLockDigest)
    } -> ${shortDigest(app.availableComponentLockDigest)}`);
  }
  if (app.installedPackageDigest || app.availablePackageDigest) {
    lines.push(`${t('productSystem.manage.updatePreviewPackage')}: ${
      shortDigest(app.installedPackageDigest)
    } -> ${shortDigest(app.availablePackageDigest)}`);
  }

  return lines.join('\n\n');
}

function appHasManagementAction(app: ProductAppCatalogEntry, action: AppManagementAction): boolean {
  return app.management?.actions?.includes(action) === true;
}

function appHasCatalogIssues(app: ProductAppCatalogEntry): boolean {
  return (app.catalogIssues?.length ?? 0) > 0;
}

function managementAppKey(app: Pick<ProductAppCatalogEntry, 'id' | 'version'>): string {
  return `${app.id}@${app.version}`;
}

function visibleAuthors(authors?: AppAuthor[] | null): AppAuthor[] {
  return (authors ?? []).filter((author) => author.name.trim().length > 0);
}

function ManagementAuthorInline({
  authors,
  className = 'management-list__author',
  t,
}: {
  authors?: AppAuthor[] | null;
  className?: string;
  t: ManagementListProps['t'];
}) {
  const visible = visibleAuthors(authors);
  if (!visible.length) return null;

  const label = visible.length > 1
    ? t('productSystem.fields.authors')
    : t('productSystem.fields.author');

  return (
    <span className={className} title={`${label}: ${visible.map((author) => author.name).join(', ')}`}>
      <span>{label}</span>
      <span className="management-list__author-separator" aria-hidden>·</span>
      <span className="management-list__author-names">
        {visible.map((author, index) => (
          <React.Fragment key={`${author.name}-${author.url ?? index}`}>
            {index > 0 ? ', ' : null}
            {author.url ? (
              <a
                href={author.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                {author.name}
              </a>
            ) : (
              <span>{author.name}</span>
            )}
          </React.Fragment>
        ))}
      </span>
    </span>
  );
}

export type ManageViewMode = 'list' | 'cards';

function formatCatalogDate(value?: number | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleDateString();
}

function buildCardMeta(app: ProductAppCatalogEntry): string {
  const parts = [
    app.version,
  ];
  const published = formatCatalogDate(app.catalogPublishedAtMs);
  if (published) parts.push(published);
  return parts.join(' | ');
}

interface ManagementListProps {
  apps: ProductAppCatalogEntry[];
  viewMode: ManageViewMode;
  managingAppId: string | null;
  runningAppIds: Set<string>;
  onInstall: (app: ProductAppCatalogEntry) => void;
  onSetEnabled: (app: ProductAppCatalogEntry, enabled: boolean) => void;
  onUninstall: (app: ProductAppCatalogEntry) => void;
  onOpenDetails: (app: ProductAppCatalogEntry) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function useManagementMoreMenu({
  canUninstall,
  managing,
  onOpenDetails,
  onUninstallRequest,
  t,
}: {
  canUninstall: boolean;
  managing: boolean;
  onOpenDetails: () => void;
  onUninstallRequest: () => void;
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
  ];
  if (canUninstall) {
    moreMenuItems.push({ type: 'separator', id: 'uninstall-separator' });
    moreMenuItems.push({
      type: 'item',
      id: 'uninstall',
      label: t('productSystem.manage.uninstall'),
      onClick: () => { onUninstallRequest(); },
      disabled: managing,
    });
  }

  const menu = (
    <>
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
        minWidth={160}
      />
    </>
  );

  return { menuAnchorRef, menuOpen, menu };
}

function ManagementRow({
  app,
  disabled,
  running,
  managing,
  onOpenDetails,
  onInstallRequest,
  onToggleEnabled,
  onUninstallRequest,
  t,
}: {
  app: ProductAppCatalogEntry;
  disabled: boolean;
  running: boolean;
  managing: boolean;
  onOpenDetails: () => void;
  onInstallRequest: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onUninstallRequest: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const hasIssue = appHasCatalogIssues(app);
  const canInstall = appHasManagementAction(app, 'install') && !hasIssue;
  const canUpdate = appHasManagementAction(app, 'update') && !hasIssue;
  const canDisable = appHasManagementAction(app, 'disable');
  const canUninstall = appHasManagementAction(app, 'uninstall');
  const hasUpdate = app.updateAvailable === true;
  const isInstalled = app.installed === true;
  const { menu } = useManagementMoreMenu({
    canUninstall,
    managing,
    onOpenDetails,
    onUninstallRequest,
    t,
  });

  return (
    <DataListItem
      className={`management-list__row${disabled ? ' is-disabled' : ''}`}
      interactive
      onClick={onOpenDetails}
      data-testid="product-app-management-row"
      data-app-id={app.id}
      data-app-version={app.version}
      data-installed={app.installed === true ? 'true' : 'false'}
      data-discoverable={app.discoverable === true ? 'true' : 'false'}
      data-update-available={hasUpdate ? 'true' : 'false'}
      data-can-install={canInstall ? 'true' : 'false'}
      data-can-update={canUpdate ? 'true' : 'false'}
      data-can-disable={canDisable ? 'true' : 'false'}
      data-can-uninstall={canUninstall ? 'true' : 'false'}
      data-has-catalog-issues={hasIssue ? 'true' : 'false'}
      data-management-origin={app.management?.origin ?? 'hidden'}
      data-catalog-source-kind={app.catalogSource?.kind ?? ''}
    >
      <div className="management-list__main">
        <span className="management-list__icon management-list__icon--logo" aria-hidden>
          <AppIcon app={app} size={26} />
        </span>
        <div className="management-list__info">
          <div className="management-list__name-row">
            <strong className="management-list__name">{app.name}</strong>
            <StatusDot
              tone={hasIssue ? 'error' : disabled ? 'neutral' : running ? 'success' : 'neutral'}
              size="small"
              pulse={running && !disabled && !hasIssue}
            />
          </div>
          <span className="management-list__description">
            {app.description}
          </span>
          <div className="management-list__meta">
            <ManagementAuthorInline authors={app.authors} t={t} />
            <span className="management-list__version">{app.version}</span>
            {app.catalogSource?.kind ? (
              <Tag size="small" color="gray">
                {t(`productSystem.catalogSource.${app.catalogSource.kind}`)}
              </Tag>
            ) : null}
            {hasUpdate ? (
              <Tag size="small" color="blue">
                {t('productSystem.manage.updateAvailable')}
              </Tag>
            ) : null}
            {hasIssue ? (
              <Tag size="small" color="red" title={app.catalogIssues?.[0]?.message}>
                {t('productSystem.manage.packageIssue')}
              </Tag>
            ) : null}
          </div>
        </div>
      </div>

      <div className="management-list__row-controls" onClick={(event) => event.stopPropagation()}>
        {!isInstalled ? (
          canInstall ? (
            <IconButton
              variant="ghost"
              size="small"
              shape="circle"
              aria-label={t('productSystem.manage.install')}
              tooltip={t('productSystem.manage.install')}
              onClick={onInstallRequest}
              disabled={managing}
              aria-busy={managing || undefined}
            >
              <Download size={14} aria-hidden />
            </IconButton>
          ) : null
        ) : (
          <>
            {hasUpdate && canUpdate ? (
              <IconButton
                variant="ghost"
                size="small"
                shape="circle"
                className="management-list__update-button"
                aria-label={t('productSystem.manage.update')}
                tooltip={t('productSystem.manage.update')}
                onClick={onInstallRequest}
                disabled={managing}
                aria-busy={managing || undefined}
              >
                <RefreshCw size={14} aria-hidden />
              </IconButton>
            ) : null}
            {canDisable ? (
              <Switch
                size="small"
                checked={app.enabled}
                disabled={managing}
                aria-label={app.enabled ? t('productSystem.manage.disable') : t('productSystem.manage.enable')}
                onChange={(event) => onToggleEnabled(event.target.checked)}
                data-testid="product-app-management-row-toggle"
              />
            ) : null}
          </>
        )}
        {menu}
      </div>
    </DataListItem>
  );
}

function ManagementCard({
  app,
  disabled,
  running,
  managing,
  onOpenDetails,
  onInstallRequest,
  onToggleEnabled,
  onUninstallRequest,
  t,
}: {
  app: ProductAppCatalogEntry;
  disabled: boolean;
  running: boolean;
  managing: boolean;
  onOpenDetails: () => void;
  onInstallRequest: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onUninstallRequest: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { menu } = useManagementMoreMenu({
    canUninstall: appHasManagementAction(app, 'uninstall'),
    managing,
    onOpenDetails,
    onUninstallRequest,
    t,
  });
  const hasIssue = appHasCatalogIssues(app);
  const canInstall = appHasManagementAction(app, 'install') && !hasIssue;
  const canUpdate = appHasManagementAction(app, 'update') && !hasIssue;
  const canDisable = appHasManagementAction(app, 'disable');
  const canUninstall = appHasManagementAction(app, 'uninstall');
  const hasUpdate = app.updateAvailable === true;
  const isInstalled = app.installed === true;

  const primaryAction = !isInstalled ? (
    canInstall ? (
      <Button
        variant="ghost"
        size="small"
        className="management-list__card-action"
        onClick={(event) => { event.stopPropagation(); onInstallRequest(); }}
        disabled={managing}
        isLoading={managing}
      >
        {t('productSystem.manage.install')}
      </Button>
    ) : null
  ) : hasUpdate && canUpdate ? (
    <Button
      variant="ghost"
      size="small"
      className="management-list__card-action"
      onClick={(event) => { event.stopPropagation(); onInstallRequest(); }}
      disabled={managing}
      isLoading={managing}
    >
      {t('productSystem.manage.update')}
    </Button>
  ) : canUninstall ? (
    <Button
      variant="ghost"
      size="small"
      className="management-list__card-action"
      onClick={(event) => { event.stopPropagation(); onUninstallRequest(); }}
      disabled={managing}
    >
      {t('productSystem.manage.uninstall')}
    </Button>
  ) : null;

  return (
    <ItemCard
      className={`management-list__card${disabled ? ' is-disabled' : ''}`}
      onActivate={onOpenDetails}
      aria-label={app.name}
      data-testid="product-app-management-card"
      data-app-id={app.id}
      data-app-version={app.version}
      data-has-catalog-issues={hasIssue ? 'true' : 'false'}
    >
      <div className="management-list__card-menu" onClick={(event) => event.stopPropagation()}>
        {menu}
      </div>
      <div className="management-list__card-body">
        <span className="management-list__card-icon management-list__card-icon--logo" aria-hidden>
          <AppIcon app={app} size={58} />
        </span>
        <div className="management-list__card-name-row">
          <strong className="management-list__card-name">{app.name}</strong>
          <StatusDot
            tone={hasIssue ? 'error' : disabled ? 'neutral' : running ? 'success' : 'neutral'}
            size="small"
            pulse={running && !disabled && !hasIssue}
          />
        </div>
        <ManagementAuthorInline
          authors={app.authors}
          className="management-list__card-author"
          t={t}
        />
        <span className="management-list__card-meta">{buildCardMeta(app)}</span>
        {hasUpdate ? (
          <Tag size="small" color="blue" className="management-list__card-tag">
            {t('productSystem.manage.updateAvailable')}
          </Tag>
        ) : null}
        {hasIssue ? (
          <Tag size="small" color="red" className="management-list__card-tag" title={app.catalogIssues?.[0]?.message}>
            {t('productSystem.manage.packageIssue')}
          </Tag>
        ) : null}
      </div>
      <div className="management-list__card-footer" onClick={(event) => event.stopPropagation()}>
        {primaryAction}
        {isInstalled && canDisable ? (
          <Switch
            size="small"
            checked={app.enabled}
            disabled={managing}
            aria-label={app.enabled ? t('productSystem.manage.disable') : t('productSystem.manage.enable')}
            onChange={(event) => onToggleEnabled(event.target.checked)}
          />
        ) : null}
      </div>
    </ItemCard>
  );
}

export function ManageViewToggle({
  viewMode,
  onChange,
  t,
}: {
  viewMode: ManageViewMode;
  onChange: (mode: ManageViewMode) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div className="management-list__view-toggle" role="group" aria-label={t('productSystem.manage.viewModeLabel')}>
      <IconButton
        variant={viewMode === 'list' ? 'default' : 'ghost'}
        size="small"
        shape="square"
        aria-label={t('productSystem.manage.viewMode.list')}
        aria-pressed={viewMode === 'list'}
        tooltip={t('productSystem.manage.viewMode.list')}
        onClick={() => onChange('list')}
      >
        <List size={14} aria-hidden />
      </IconButton>
      <IconButton
        variant={viewMode === 'cards' ? 'default' : 'ghost'}
        size="small"
        shape="square"
        aria-label={t('productSystem.manage.viewMode.cards')}
        aria-pressed={viewMode === 'cards'}
        tooltip={t('productSystem.manage.viewMode.cards')}
        onClick={() => onChange('cards')}
      >
        <LayoutGrid size={14} aria-hidden />
      </IconButton>
    </div>
  );
}

export const ManagementList: React.FC<ManagementListProps> = ({
  apps,
  viewMode,
  managingAppId,
  runningAppIds,
  onInstall,
  onSetEnabled,
  onUninstall,
  onOpenDetails,
  t,
}) => {
  const [uninstallTarget, setUninstallTarget] = useState<ProductAppCatalogEntry | null>(null);
  const [updateTarget, setUpdateTarget] = useState<ProductAppCatalogEntry | null>(null);

  const handleInstallRequest = useCallback((app: ProductAppCatalogEntry) => {
    if (app.installed === true && app.updateAvailable === true) {
      setUpdateTarget(app);
      return;
    }
    onInstall(app);
  }, [onInstall]);

  const handleUpdateConfirm = useCallback(() => {
    if (!updateTarget) return;
    onInstall(updateTarget);
    setUpdateTarget(null);
  }, [onInstall, updateTarget]);

  const handleUninstallConfirm = useCallback(() => {
    if (!uninstallTarget) return;
    onUninstall(uninstallTarget);
    setUninstallTarget(null);
  }, [onUninstall, uninstallTarget]);

  return (
    <>
      <ConfirmDialog
        open={updateTarget !== null}
        onOpenChange={(open) => { if (!open) setUpdateTarget(null); }}
        onConfirm={handleUpdateConfirm}
        onCancel={() => setUpdateTarget(null)}
        type="warning"
        title={updateTarget ? t('productSystem.manage.updateTitle') : ''}
        message={updateTarget ? t('productSystem.manage.updateMessage', {
          name: updateTarget.name,
        }) : ''}
        preview={updateTarget ? updatePreview(updateTarget, t) : undefined}
        previewMaxHeight={260}
        confirmText={t('productSystem.manage.updateConfirm')}
        cancelText={t('productSystem.actions.cancel')}
      />
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
        }) : ''}
        confirmText={t('productSystem.manage.uninstallConfirm')}
        cancelText={t('productSystem.actions.cancel')}
      />
      {apps.length === 0 ? (
        <EmptyState
          imageSize="small"
          title={t('productSystem.manage.emptyTitle')}
          description={t('productSystem.manage.emptyDescription')}
        />
      ) : viewMode === 'cards' ? (
        <div className="management-list__card-grid" role="list" aria-label={t('productSystem.manage.listLabel')}>
          {apps.map((app) => {
            const isDisabled = app.installed !== true || !app.enabled;
            const appKey = managementAppKey(app);
            return (
              <ManagementCard
                key={appKey}
                app={app}
                disabled={isDisabled}
                running={runningAppIds.has(app.id)}
                managing={managingAppId === app.id}
                onOpenDetails={() => onOpenDetails(app)}
                onInstallRequest={() => handleInstallRequest(app)}
                onToggleEnabled={(enabled) => onSetEnabled(app, enabled)}
                onUninstallRequest={() => setUninstallTarget(app)}
                t={t}
              />
            );
          })}
        </div>
      ) : (
        <DataList className="management-list__data-list" aria-label={t('productSystem.manage.listLabel')}>
          {apps.map((app) => {
            const isDisabled = app.installed !== true || !app.enabled;
            const appKey = managementAppKey(app);
            return (
              <ManagementRow
                key={appKey}
                app={app}
                disabled={isDisabled}
                running={runningAppIds.has(app.id)}
                managing={managingAppId === app.id}
                onOpenDetails={() => onOpenDetails(app)}
                onInstallRequest={() => handleInstallRequest(app)}
                onToggleEnabled={(enabled) => onSetEnabled(app, enabled)}
                onUninstallRequest={() => setUninstallTarget(app)}
                t={t}
              />
            );
          })}
        </DataList>
      )}
    </>
  );
};

export default ManagementList;
