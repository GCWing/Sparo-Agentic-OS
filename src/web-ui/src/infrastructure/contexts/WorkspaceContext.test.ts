import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/business/workspaceManager', () => ({
  workspaceManager: {
    addEventListener: vi.fn(),
  },
}));

const workspaceContextGlobal = globalThis as typeof globalThis & {
  __sparoWorkspaceContext?: unknown;
};

describe('WorkspaceContext development identity', () => {
  beforeEach(() => {
    delete workspaceContextGlobal.__sparoWorkspaceContext;
    vi.resetModules();
  });

  afterEach(() => {
    delete workspaceContextGlobal.__sparoWorkspaceContext;
    vi.resetModules();
  });

  it('survives a module reload', async () => {
    const firstModule = await import('./WorkspaceContext');

    vi.resetModules();
    const replacementModule = await import('./WorkspaceContext');

    expect(replacementModule.WorkspaceContext).toBe(firstModule.WorkspaceContext);
  });
});
