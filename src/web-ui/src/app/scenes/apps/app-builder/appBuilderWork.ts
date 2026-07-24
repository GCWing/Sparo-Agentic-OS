import { nativeAppWorkRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type {
  ResolveComponentWorkRequest,
} from '@/app/agentic-os/work/domain/workTypes';
import type {
  AppDraftRecord,
  IntelligentAppRecord,
} from '@/infrastructure/api/service-api/IntelligentAppAPI';
import { type AppScope, workScopeFromAppScope } from '@/shared/types/app-scope';

const APP_BUILDER_APP_ID = 'app-builder';
const APP_BUILDER_DRAFT_COMPONENT_KIND = 'product_app_draft';

interface AppBuilderWorkDraftRequest {
  app: IntelligentAppRecord;
  draft: AppDraftRecord;
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
    workspacePath: scope.kind === 'workspace' ? scope.workspacePath : undefined,
    visibility: 'primary',
    primarySurfacePolicy: 'work_session',
    assignment: {
      kind: 'agent',
      agentType: 'AppBuilder',
    },
    appRefs: [{ app: appBuilder, role: 'executor' }],
  };
}
