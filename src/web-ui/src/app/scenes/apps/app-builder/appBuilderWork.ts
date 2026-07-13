import { nativeAppWorkRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type {
  ResolveComponentWorkRequest,
  WorkScope,
} from '@/app/agentic-os/work/domain/workTypes';
import type {
  AppDraftRecord,
  IntelligentAppRecord,
} from '@/infrastructure/api/service-api/IntelligentAppAPI';
import type { AppScope } from '@/shared/types/app-scope';

const APP_BUILDER_APP_ID = 'app-builder';
const APP_BUILDER_DRAFT_COMPONENT_KIND = 'product_app_draft';

interface AppBuilderWorkDraftRequest {
  app: IntelligentAppRecord;
  draft: AppDraftRecord;
}

function workScopeFromAppScope(scope: AppScope): WorkScope {
  return scope.kind === 'workspace'
    ? { kind: 'workspace', workspacePath: scope.workspacePath }
    : { kind: 'system' };
}

export function buildAppBuilderWorkRequest(
  request: AppBuilderWorkDraftRequest,
  scope: AppScope,
): ResolveComponentWorkRequest {
  const appBuilder = nativeAppWorkRef(APP_BUILDER_APP_ID);
  return {
    component: {
      componentId: request.draft.draftId,
      componentKind: APP_BUILDER_DRAFT_COMPONENT_KIND,
    },
    intent: 'develop',
    title: request.app.displayName,
    objective: request.app.description?.trim() || request.app.displayName,
    scope: workScopeFromAppScope(scope),
    visibility: 'primary',
    primarySurfacePolicy: 'work_session',
    assignment: {
      kind: 'agent',
      agentType: 'AppBuilder',
    },
    appRefs: [{ app: appBuilder, role: 'executor' }],
  };
}
