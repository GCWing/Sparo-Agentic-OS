import React, { Suspense, lazy } from 'react';
import { ProcessingIndicator } from '@/flow_chat/components/modern/ProcessingIndicator';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import type { WorkspaceSurface } from '../navigation/workspaceSurfaceTypes';
import type { WorkspaceSceneId } from '../navigation/workspaceSceneTypes';
import {
  normalizeAppScope,
  type AppScope,
} from '@/shared/types/app-scope';
import {
  appScopeFromRuntimeScope,
  projectWorkspacePathFromRuntimeScope,
  runtimeScopeFromSession,
  runtimeScopeIdentity,
  systemRuntimeScope,
  type RuntimeScope,
} from '@/shared/types/runtime-scope';
import { useFlowChatStoreSelector } from '@/flow_chat/hooks/useFlowChatStoreSelector';
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
const SurfaceComponentScene = lazy(() => import('../scenes/apps/SurfaceComponentScene'));
const PanelViewScene = lazy(() => import('../scenes/panel-view/PanelViewScene'));
const WorkCenterScene = lazy(() => import('../scenes/work-center/WorkCenterScene'));

interface SurfaceRendererProps {
  surface: WorkspaceSurface;
  isEntering?: boolean;
}

const SurfaceRenderer: React.FC<SurfaceRendererProps> = ({
  surface,
  isEntering = false,
}) => {
  const { t } = useI18n('common');
  const sessionScope = useFlowChatStoreSelector(
    (state) => {
      if (surface.kind === 'agentic-os-home') {
        return systemRuntimeScope();
      }
      if (surface.kind !== 'session') {
        return null;
      }
      return runtimeScopeFromSession(state.sessions.get(surface.sessionId));
    },
    (left, right) => runtimeScopeIdentity(left) === runtimeScopeIdentity(right),
  );

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
          {renderSurface(surface, sessionScope, isEntering)}
        </Suspense>
      </div>
    </div>
  );
};

function renderSurface(
  surface: WorkspaceSurface,
  sessionScope: RuntimeScope | null,
  isEntering: boolean
): React.ReactNode {
  switch (surface.kind) {
    case 'agentic-os-home':
      return (
        <SessionScene
          workspacePath={undefined}
          surfaceSessionId={surface.agenticOsSessionId}
          isEntering={isEntering}
          isActive
        />
      );
    case 'session':
      return (
        <SessionScene
          workspacePath={projectWorkspacePathFromRuntimeScope(sessionScope)}
          surfaceSessionId={surface.kind === 'session' ? surface.sessionId : undefined}
          isEntering={isEntering}
          isActive
        />
      );
    case 'scene':
      {
        const sceneWorkspacePath = projectWorkspacePathFromRuntimeScope(surface.scope);
        const sceneAppScope = surface.appScope
          ? normalizeAppScope(surface.appScope)
          : appScopeFromRuntimeScope(surface.scope);
        return renderSceneSurface(surface.sceneId, sceneWorkspacePath, sceneAppScope);
      }
  }
}

function renderSceneSurface(
  id: WorkspaceSceneId,
  workspacePath: string | undefined,
  appScope: AppScope
): React.ReactNode {
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
      return <ShellScene workspacePath={workspacePath} isActive />;
    case 'panel-view':
      return <PanelViewScene workspacePath={workspacePath} />;
    case 'work-center':
      return <WorkCenterScene />;
    default:
      if (typeof id === 'string' && id.startsWith('app-surface:')) {
        return (
          <SurfaceComponentScene
            appId={id.slice('app-surface:'.length)}
            workspacePath={workspacePath}
            scope={appScope}
          />
        );
      }
      return null;
  }
}

export default SurfaceRenderer;
