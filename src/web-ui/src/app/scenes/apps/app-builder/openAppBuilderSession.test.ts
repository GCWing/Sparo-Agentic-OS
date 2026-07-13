import { describe, expect, it } from 'vitest';
import type {
  AppDraftRecord,
  IntelligentAppRecord,
} from '@/infrastructure/api/service-api/IntelligentAppAPI';
import { buildAppBuilderWorkRequest } from './appBuilderWork';

const app = {
  appId: 'app-1',
  slotId: 'slot-1',
  displayName: 'Research Assistant',
  description: 'Organize research evidence',
} as IntelligentAppRecord;

const draft = {
  draftId: 'draft-1',
} as AppDraftRecord;

describe('buildAppBuilderWorkRequest', () => {
  it('makes the mutable Draft the Work subject and App Builder its executor', () => {
    const request = buildAppBuilderWorkRequest(
      { app, draft },
      { kind: 'workspace', workspacePath: 'D:/workspace/project' },
    );

    expect(request.component).toEqual({
      componentId: 'draft-1',
      componentKind: 'product_app_draft',
    });
    expect(request.intent).toBe('develop');
    expect(request.scope).toEqual({ kind: 'workspace', workspacePath: 'D:/workspace/project' });
    expect(request.primarySurfacePolicy).toBe('work_session');
    expect(request.assignment).toEqual({ kind: 'agent', agentType: 'AppBuilder' });
    expect(request.appRefs).toEqual([{
      app: expect.objectContaining({ kind: 'native_app', appId: 'app-builder' }),
      role: 'executor',
    }]);
  });

  it('uses the same Draft identity for create and later edit openings', () => {
    const createRequest = buildAppBuilderWorkRequest({ app, draft }, { kind: 'system' });
    const editRequest = buildAppBuilderWorkRequest({
      app,
      draft: { ...draft, baseReleaseId: 'release-1' },
    }, { kind: 'system' });

    expect(editRequest.component).toEqual(createRequest.component);
    expect(editRequest.intent).toBe(createRequest.intent);
  });
});
