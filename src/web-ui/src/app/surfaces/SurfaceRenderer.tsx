import React, { Suspense, lazy } from 'react';
import { ProcessingIndicator } from '@/flow_chat/components/modern/ProcessingIndicator';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import type { WorkspaceSurface } from '../navigation/workspaceSurfaceTypes';
import type { WorkspaceSceneId } from '../navigation/workspaceSceneTypes';
import SessionScene from '../scenes/session/SessionScene';
import SettingsScene from '../scenes/settings/SettingsScene';
import AppsScene from '../scenes/apps/AppsScene';

const TerminalScene = lazy(() => import('../scenes/terminal/TerminalScene'));
const FileViewerScene = lazy(() => import('../scenes/file-viewer/FileViewerScene'));
const MemoryScene = lazy(() => import('../scenes/memory/MemoryScene'));
const SubagentsScene = lazy(() => import('../scenes/subagents/SubagentsScene'));
const SkillsScene = lazy(() => import('../scenes/skills/SkillsScene'));
const ToolsScene = lazy(() => import('../scenes/tools/ToolsScene'));
const ShellScene = lazy(() => import('../scenes/shell/ShellScene'));
const LiveAppScene = lazy(() => import('../scenes/apps/LiveAppScene'));
const PanelViewScene = lazy(() => import('../scenes/panel-view/PanelViewScene'));
const WorkCenterScene = lazy(() => import('../scenes/work-center/WorkCenterScene'));

interface SurfaceRendererProps {
  surface: WorkspaceSurface;
  workspacePath?: string;
  isEntering?: boolean;
}

const SurfaceRenderer: React.FC<SurfaceRendererProps> = ({
  surface,
  workspacePath,
  isEntering = false,
}) => {
  const { t } = useI18n('common');

  return (
    <div className="workspace-surface-renderer">
      <div className="workspace-surface-renderer__fill">
        <Suspense
          fallback={
            <div
              className="workspace-surface-renderer__fallback"
              role="status"
              aria-busy="true"
              aria-label={t('loading.scenes')}
            >
              <ProcessingIndicator visible />
            </div>
          }
        >
          {renderSurface(surface, workspacePath, isEntering)}
        </Suspense>
      </div>
    </div>
  );
};

function renderSurface(
  surface: WorkspaceSurface,
  workspacePath: string | undefined,
  isEntering: boolean
): React.ReactNode {
  switch (surface.kind) {
    case 'dispatcher-home':
    case 'session':
      return (
        <SessionScene
          workspacePath={workspacePath}
          isEntering={isEntering}
          isActive
        />
      );
    case 'scene':
      return renderSceneSurface(
        surface.sceneId,
        surface.workspacePath === null ? undefined : surface.workspacePath ?? workspacePath
      );
  }
}

function renderSceneSurface(id: WorkspaceSceneId, workspacePath?: string): React.ReactNode {
  switch (id) {
    case 'terminal':
      return <TerminalScene isActive />;
    case 'settings':
      return <SettingsScene />;
    case 'file-viewer':
      return <FileViewerScene key={workspacePath ?? 'home'} workspacePath={workspacePath} />;
    case 'memory':
      return <MemoryScene />;
    case 'apps':
      return <AppsScene />;
    case 'subagents':
      return <SubagentsScene />;
    case 'skills':
      return <SkillsScene />;
    case 'tools':
      return <ToolsScene />;
    case 'shell':
      return <ShellScene isActive />;
    case 'panel-view':
      return <PanelViewScene workspacePath={workspacePath} />;
    case 'work-center':
      return <WorkCenterScene />;
    default:
      if (typeof id === 'string' && id.startsWith('live-app:')) {
        return <LiveAppScene appId={id.slice('live-app:'.length)} />;
      }
      return null;
  }
}

export default SurfaceRenderer;
