import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkDockStore } from '@/app/stores/workDockStore';
import { openArtifactInCenter, openWorkInCenter } from './openWork';
import { openWorkspaceScene } from '@/app/navigation/workspaceNavigation';

vi.mock('@/app/navigation/workspaceNavigation', () => ({
  openWorkspaceScene: vi.fn(),
}));
vi.mock('@/flow_chat/services/childSessionPanels', () => ({
  openMainSession: vi.fn(),
}));
vi.mock('@/app/scenes/apps/product-app-runtime/productAppRuntimeService', () => ({
  openProductAppRuntimeForWorkSurface: vi.fn(),
}));

function resetWorkDockStore() {
  useWorkDockStore.setState({
    workCenterScope: { kind: 'open' },
    workCenterView: 'work',
    workCenterWorkspaceFilter: { kind: 'all' },
    workCenterAppFilter: { kind: 'all' },
    workCenterGrouping: 'priority',
    workCenterSelectedWorkId: null,
    workCenterSelectedArtifactId: null,
    workCenterCollapsedGroups: [],
  });
}

describe('openWork navigation', () => {
  beforeEach(() => {
    resetWorkDockStore();
    vi.mocked(openWorkspaceScene).mockClear();
  });

  it('opens an artifact in its owner Work Center context', () => {
    openArtifactInCenter('work_1', 'artifact_1');

    const state = useWorkDockStore.getState();
    expect(state.workCenterScope).toEqual({ kind: 'all' });
    expect(state.workCenterSelectedWorkId).toBe('work_1');
    expect(state.workCenterSelectedArtifactId).toBe('artifact_1');
    expect(openWorkspaceScene).toHaveBeenCalledWith('work-center');
  });

  it('clears artifact focus when opening a Work directly', () => {
    openArtifactInCenter('work_1', 'artifact_1');

    openWorkInCenter('work_2');

    const state = useWorkDockStore.getState();
    expect(state.workCenterSelectedWorkId).toBe('work_2');
    expect(state.workCenterSelectedArtifactId).toBeNull();
  });
});
