import { describe, expect, it } from 'vitest';
import {
  appScopeIdentity,
  appScopeFromWorkScope,
  appScopeFromWorkspaceIdentity,
  workScopeFromAppScope,
} from './app-scope';

describe('AppScope workspace identity', () => {
  it('keeps the stable Workspace ID when converting between App and Work scope', () => {
    const appScope = appScopeFromWorkspaceIdentity({
      workspaceId: ' ws_contract ',
      workspacePath: ' D:/workspace/project ',
      workspaceName: ' Project ',
    });

    expect(appScope).toEqual({
      kind: 'workspace',
      workspaceId: 'ws_contract',
      workspacePath: 'D:/workspace/project',
      workspaceName: 'Project',
    });
    expect(workScopeFromAppScope(appScope)).toEqual({
      kind: 'workspace',
      workspaceId: 'ws_contract',
    });
  });

  it('reconstructs App scope from a typed Work scope without downgrading to global', () => {
    expect(appScopeFromWorkScope(
      { kind: 'workspace', workspaceId: 'ws_contract' },
      'D:/workspace/project',
    )).toEqual({
      kind: 'workspace',
      workspaceId: 'ws_contract',
      workspacePath: 'D:/workspace/project',
      workspaceName: null,
    });
  });

  it('rejects path-only scope at the Work persistence boundary', () => {
    expect(() => workScopeFromAppScope({
      kind: 'workspace',
      workspacePath: 'D:/workspace/project',
    })).toThrow('Workspace scope requires workspaceId');
  });

  it('uses stable Workspace ID as identity and keeps path-only scope explicitly separate', () => {
    expect(appScopeIdentity({
      kind: 'workspace',
      workspaceId: 'ws_contract',
      workspacePath: 'D:/workspace/project',
    })).toBe('workspace:ws_contract');
    expect(appScopeIdentity({
      kind: 'workspace',
      workspacePath: 'D:/workspace/project',
    })).toBe('workspace-path:d:/workspace/project');
  });
});
