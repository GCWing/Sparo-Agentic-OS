import { FolderOpen, Globe2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  Radio,
} from '@/design-system';
import { getWorkspaceDisplayName } from '@/infrastructure/contexts/WorkspaceContext';
import {
  appScopeFromWorkspace,
  appScopeIdentity,
  systemAppScope,
  type AppScope,
} from '@/shared/types/app-scope';
import type { WorkspaceInfo } from '@/shared/types';
import './LiveAppScopeDialog.scss';

export type LiveAppScopeDialogMode = 'open' | 'edit' | 'recompile' | 'studio' | 'run';

interface LiveAppScopeDialogProps {
  open: boolean;
  mode: LiveAppScopeDialogMode;
  appName: string;
  workspaces: WorkspaceInfo[];
  selectedScope: AppScope;
  bestWorks?: Array<{
    id: string;
    title: string;
    objective: string;
    status: string;
    workspaceLabel: string;
  }>;
  onSelectScope: (scope: AppScope) => void;
  onSelectWork?: (workId: string) => void;
  onBrowse: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function getAppScopeFolderName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || path;
}

function scopeMatchesWorkspace(scope: AppScope, workspace: WorkspaceInfo): boolean {
  return scope.kind === 'workspace' && scope.workspacePath === workspace.rootPath;
}

export function LiveAppScopeDialog({
  open: isOpen,
  mode,
  appName,
  workspaces,
  selectedScope,
  bestWorks = [],
  onSelectScope,
  onSelectWork,
  onBrowse,
  onCancel,
  onConfirm,
  t,
}: LiveAppScopeDialogProps) {
  const selectedIdentity = appScopeIdentity(selectedScope);
  const browsedWorkspace =
    selectedScope.kind === 'workspace' && !workspaces.some((workspace) => scopeMatchesWorkspace(selectedScope, workspace))
      ? selectedScope
      : null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
      title={t(
        mode === 'edit'
          ? 'liveApp.scopeDialog.editTitle'
          : mode === 'recompile'
            ? 'liveApp.scopeDialog.recompileTitle'
            : mode === 'studio'
              ? 'liveApp.scopeDialog.studioTitle'
              : mode === 'run'
                ? 'liveApp.scopeDialog.runTitle'
            : 'liveApp.scopeDialog.openTitle',
        { name: appName },
      )}
      size="medium"
      closeOnOverlayClick={false}
    >
      <DialogBody className="live-app-scope-dialog">
        <p className="live-app-scope-dialog__lede">
          {t('liveApp.scopeDialog.description')}
        </p>
        <div className="live-app-scope-dialog__options" role="radiogroup" aria-label={t('liveApp.scopeDialog.ariaLabel')}>
          <Radio
            name="live-app-scope"
            checked={selectedIdentity === 'system'}
            onChange={() => onSelectScope(systemAppScope())}
            label={(
              <span className="live-app-scope-dialog__option-title">
                <Globe2 size={14} aria-hidden />
                {t('liveApp.scopeDialog.systemTitle')}
              </span>
            )}
            description={t('liveApp.scopeDialog.systemDescription')}
          />
          {workspaces.map((workspace) => {
            const scope = appScopeFromWorkspace(workspace) ?? systemAppScope();
            return (
              <Radio
                key={workspace.id}
                name="live-app-scope"
                checked={selectedIdentity === appScopeIdentity(scope)}
                onChange={() => onSelectScope(scope)}
                label={(
                  <span className="live-app-scope-dialog__option-title">
                    <FolderOpen size={14} aria-hidden />
                    {getWorkspaceDisplayName(workspace)}
                  </span>
                )}
                description={workspace.rootPath}
              />
            );
          })}
          {browsedWorkspace ? (
            <Radio
              name="live-app-scope"
              checked
              onChange={() => onSelectScope(browsedWorkspace)}
              label={(
                <span className="live-app-scope-dialog__option-title">
                  <FolderOpen size={14} aria-hidden />
                  {browsedWorkspace.workspaceName || getAppScopeFolderName(browsedWorkspace.workspacePath)}
                </span>
              )}
              description={browsedWorkspace.workspacePath}
            />
          ) : null}
        </div>
        <Button type="button" variant="secondary" size="small" onClick={onBrowse}>
          <FolderOpen size={14} aria-hidden />
          {t('liveApp.scopeDialog.browseFolder')}
        </Button>
        {bestWorks.length > 0 ? (
          <section className="live-app-scope-dialog__work-section">
            <div className="live-app-scope-dialog__section-title">
              {t('liveApp.scopeDialog.bestWorkTitle')}
            </div>
            <div className="live-app-scope-dialog__work-list">
              {bestWorks.map((work) => (
                <button
                  key={work.id}
                  type="button"
                  className="live-app-scope-dialog__work-item"
                  onClick={() => onSelectWork?.(work.id)}
                >
                  <span className="live-app-scope-dialog__work-main">
                    <span className="live-app-scope-dialog__work-title">{work.title}</span>
                    <span className="live-app-scope-dialog__work-objective">{work.objective}</span>
                  </span>
                  <span className="live-app-scope-dialog__work-meta">
                    <span>{work.status}</span>
                    <span>{work.workspaceLabel}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" size="small" onClick={onCancel}>
          {t('liveApp.scopeDialog.cancel')}
        </Button>
        <Button type="button" variant="primary" size="small" onClick={onConfirm}>
          {t(
            mode === 'edit'
              ? 'liveApp.scopeDialog.confirmEdit'
              : mode === 'recompile'
                ? 'liveApp.scopeDialog.confirmRecompile'
                : mode === 'studio'
                  ? 'liveApp.scopeDialog.confirmStart'
                  : mode === 'run'
                    ? 'liveApp.scopeDialog.confirmRun'
                : 'liveApp.scopeDialog.confirmOpen'
          )}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
