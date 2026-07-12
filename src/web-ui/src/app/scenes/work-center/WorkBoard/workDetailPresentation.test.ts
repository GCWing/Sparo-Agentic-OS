import { describe, expect, it } from 'vitest';
import type {
  WorkExecutionGraph,
  WorkRecord,
  WorkStatus,
} from '@/app/agentic-os/work/domain/workTypes';
import type { BackgroundProcess } from '@/app/agentic-os/background-process/domain/backgroundProcessTypes';
import {
  deriveSystemWorkDetailPresentation,
  deriveWorkDetailPresentation,
  getWorkDetailPrimaryAction,
  getWorkDetailUserState,
} from './workDetailPresentation';

function createSystemProcess(overrides: Partial<BackgroundProcess> = {}): BackgroundProcess {
  return {
    id: 'memory-consolidation',
    kind: 'memory_consolidation',
    category: 'memory',
    title: 'Memory consolidation',
    status: 'succeeded',
    scope: { kind: 'system' },
    outputRefs: [],
    actions: [],
    ...overrides,
  };
}

function createWork(overrides: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id: 'work-1',
    kind: 'multi_step',
    title: 'Ship the release',
    objective: 'Prepare a release candidate',
    status: 'active',
    visibility: 'primary',
    subject: { kind: 'goal' },
    appRefs: [],
    scope: { kind: 'workspace', workspacePath: 'D:/workspace/project' },
    primarySurface: { kind: 'work_center', workId: 'work-1' },
    surfaces: [],
    lifecycle: { events: [] },
    sessionRefs: [],
    executionBindings: [],
    runtimeInstances: [],
    artifactRefs: [],
    memoryRefs: [],
    systemManaged: false,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function createExecutionGraph(
  overrides: Partial<WorkExecutionGraph> = {}
): WorkExecutionGraph {
  return {
    workId: 'work-1',
    updatedAt: 2,
    executions: [],
    runtimeInstances: [],
    artifacts: [],
    issues: [],
    logs: [],
    builderPreviewResults: [],
    builderValidationResults: [],
    builderIssues: [],
    summary: {
      executionCount: 0,
      runtimeInstanceCount: 0,
      runtimeRunCount: 0,
      artifactCount: 0,
      issueCount: 0,
      errorCount: 0,
      warningCount: 0,
    },
    ...overrides,
  };
}

describe('work detail status presentation', () => {
  it.each<[
    WorkStatus,
    ReturnType<typeof getWorkDetailUserState>,
    ReturnType<typeof getWorkDetailPrimaryAction>,
  ]>([
    ['draft', 'ready', 'enter'],
    ['active', 'ready', 'enter'],
    ['running', 'inProgress', 'inspectProgress'],
    ['waiting_user', 'needsAction', 'handle'],
    ['blocked', 'needsAction', 'handle'],
    ['paused', 'paused', 'resume'],
    ['completed', 'resultReady', 'viewResult'],
    ['failed', 'needsAction', 'openAndHandle'],
    ['cancelled', 'inactive', 'enter'],
    ['interrupted', 'needsAction', 'openAndHandle'],
    ['archived', 'inactive', 'reopen'],
  ])('maps %s to %s with %s as the primary action', (status, userState, primaryAction) => {
    expect(getWorkDetailUserState(status)).toBe(userState);
    expect(getWorkDetailPrimaryAction(status)).toBe(primaryAction);
  });

  it('uses the effective running status when a live execution exists', () => {
    const presentation = deriveWorkDetailPresentation(createWork({
      status: 'active',
      executionBindings: [{
        id: 'execution-1',
        status: 'running',
        source: {
          source: 'agent_session_run',
          sessionId: 'session-1',
          turnId: 'turn-1',
        },
        createdAt: 1,
        updatedAt: 2,
      }],
    }));

    expect(presentation.effectiveStatus).toBe('running');
    expect(presentation.userState).toBe('inProgress');
    expect(presentation.primaryAction).toBe('inspectProgress');
  });

  it('treats a stale running status as ready to enter', () => {
    const presentation = deriveWorkDetailPresentation(createWork({ status: 'running' }));

    expect(presentation.effectiveStatus).toBe('active');
    expect(presentation.userState).toBe('ready');
    expect(presentation.primaryAction).toBe('enter');
  });
});

describe('work detail content presentation', () => {
  it('hides empty or redundant optional facts', () => {
    const presentation = deriveWorkDetailPresentation(createWork({
      objective: '   ',
      summary: { text: '  ', updatedAt: 1 },
      assignment: { kind: 'agent' },
      topicWorkId: ' ',
      createdAt: 2,
      updatedAt: 2,
    }));

    expect(presentation).toMatchObject({
      showObjective: false,
      showSummary: false,
      showAssignment: false,
      showTopic: false,
      showCreatedAt: false,
    });
  });

  it('shows meaningful optional facts', () => {
    const presentation = deriveWorkDetailPresentation(createWork({
      summary: { text: 'Release candidate is ready', updatedAt: 2 },
      assignment: { kind: 'human', humanLabel: 'Release manager' },
      topicWorkId: 'topic-1',
    }));

    expect(presentation).toMatchObject({
      showObjective: true,
      showSummary: true,
      showAssignment: true,
      showTopic: true,
      showCreatedAt: true,
    });
  });

  it('does not offer instruction or objective editing controls for system work', () => {
    const presentation = deriveWorkDetailPresentation(createWork({
      systemManaged: true,
      status: 'running',
      assignment: { kind: 'application', applicationId: 'sparo_os' },
      summary: { text: 'status=running', updatedAt: 2 },
    }));

    expect(presentation.canAppendInstructions).toBe(false);
    expect(presentation.canEditObjective).toBe(false);
    expect(presentation.showObjective).toBe(false);
    expect(presentation.showSummary).toBe(false);
    expect(presentation.showAssignment).toBe(false);
    expect(presentation.showCreatedAt).toBe(false);
    expect(presentation.showRuntimeTab).toBe(false);
  });

  it('localizes the known memory result without leaking its raw message', () => {
    const presentation = deriveSystemWorkDetailPresentation(createSystemProcess({
      finishedAt: 12,
      lastResult: {
        status: 'succeeded',
        finishedAt: 12,
        message: '7 source(s) tracked',
      },
    }));

    expect(presentation).toMatchObject({
      titleKey: 'background.kinds.memory_consolidation',
      state: 'healthy',
      statusKey: 'detail.systemStatus.healthy',
      statusTone: 'success',
      summaryKey: 'detail.currentState.memorySourcesTracked',
      summaryParams: { count: 7 },
      hasRuntimeRecord: true,
      lastFinishedAt: 12,
    });
  });

  it('uses safe state copy for unknown system result messages', () => {
    const presentation = deriveSystemWorkDetailPresentation(createSystemProcess({
      status: 'failed',
      lastError: 'internal process failure: secret implementation detail',
      lastResult: {
        status: 'failed',
        message: 'opaque backend message',
      },
    }));

    expect(presentation).toMatchObject({
      state: 'attention',
      statusKey: 'detail.systemStatus.attention',
      statusTone: 'error',
      summaryKey: 'detail.currentState.systemAttention',
      hasRuntimeRecord: true,
    });
    expect(JSON.stringify(presentation)).not.toContain('opaque backend message');
    expect(JSON.stringify(presentation)).not.toContain('secret implementation detail');
  });

  it('disables appended instructions while archived', () => {
    const presentation = deriveWorkDetailPresentation(createWork({ status: 'archived' }));

    expect(presentation.canAppendInstructions).toBe(false);
    expect(presentation.primaryAction).toBe('reopen');
  });
});

describe('work detail tab presentation', () => {
  it('shows outputs for artifacts from either the record or execution graph', () => {
    const fromRecord = deriveWorkDetailPresentation(createWork({
      artifactRefs: [{ id: 'artifact-1', uri: 'D:/workspace/project/report.md' }],
    }));
    const fromGraph = deriveWorkDetailPresentation(
      createWork(),
      createExecutionGraph({
        summary: {
          executionCount: 0,
          runtimeInstanceCount: 0,
          runtimeRunCount: 0,
          artifactCount: 1,
          issueCount: 0,
          errorCount: 0,
          warningCount: 0,
        },
      })
    );

    expect(fromRecord).toMatchObject({
      hasArtifacts: true,
      hasOutputs: true,
      showOutputsTab: true,
    });
    expect(fromGraph).toMatchObject({
      hasArtifacts: true,
      hasOutputs: true,
      showOutputsTab: true,
    });
  });

  it('treats a navigable surface as an output destination', () => {
    const presentation = deriveWorkDetailPresentation(createWork({
      primarySurface: { kind: 'agent_session', sessionId: 'session-1' },
    }));

    expect(presentation).toMatchObject({
      hasArtifacts: false,
      hasDestinations: true,
      hasOutputs: true,
      showOutputsTab: true,
    });
  });

  it('does not treat Work Center or OS Agent home loops as destinations', () => {
    const presentation = deriveWorkDetailPresentation(createWork({
      surfaces: [
        { kind: 'work_center', workId: 'work-1' },
        { kind: 'os_agent_home', agenticOsSessionId: 'agentic-os-1' },
      ],
    }));

    expect(presentation.hasDestinations).toBe(false);
    expect(presentation.showOutputsTab).toBe(false);
  });

  it('shows runtime records for bound executions and graph evidence', () => {
    const fromBinding = deriveWorkDetailPresentation(createWork({
      executionBindings: [{
        id: 'execution-1',
        status: 'completed',
        source: {
          source: 'agent_session_run',
          sessionId: 'session-1',
        },
        createdAt: 1,
        updatedAt: 2,
      }],
    }));
    const fromGraph = deriveWorkDetailPresentation(
      createWork(),
      createExecutionGraph({
        summary: {
          executionCount: 0,
          runtimeInstanceCount: 0,
          runtimeRunCount: 0,
          artifactCount: 0,
          issueCount: 1,
          errorCount: 1,
          warningCount: 0,
        },
      })
    );

    expect(fromBinding).toMatchObject({
      hasRuntimeRecord: true,
      hasActivity: true,
      showRuntimeTab: true,
    });
    expect(fromGraph).toMatchObject({
      hasRuntimeRecord: true,
      hasActivity: true,
      showRuntimeTab: true,
    });
  });

  it('keeps lifecycle activity in the overview without creating an empty runtime tab', () => {
    const presentation = deriveWorkDetailPresentation(createWork({
      lifecycle: {
        events: [{ status: 'active', label: 'created', at: 1 }],
      },
    }));

    expect(presentation.hasActivity).toBe(true);
    expect(presentation.hasRuntimeRecord).toBe(false);
    expect(presentation.showRuntimeTab).toBe(false);
  });
});
