import { describe, expect, it } from 'vitest';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import { buildWorkStudioPreviewResultFromToolResult } from './appStudioPreviewResult';

const runtimeContext: ProductAppRuntimeContext = {
  workId: 'work-1',
  runtimeInstanceId: 'runtime-1',
  productAppId: 'app-1',
  productAppVersion: '1.0.0',
  componentLockDigest: 'sha256:lock',
  productAppSurfaceId: 'surface-1',
  surfaceId: 'primary',
  hostSurfaceId: 'runtime-1',
};

describe('appStudioPreviewResult', () => {
  it('projects RunStudioPreview capability results into Work graph preview facts', () => {
    const preview = buildWorkStudioPreviewResultFromToolResult({
      status: 'passed',
      previewResultId: 'preview:capability:runtime',
      kind: 'capability',
      source: 'preview-harness',
      harnessMode: 'capability',
      componentId: 'interactive-runtime',
      checks: [
        {
          id: 'capabilityCall',
          status: 'passed',
          detail: 'Interactive surface runtime runtime://interactive-surface resolved.',
        },
        {
          id: 'capabilityLogs',
          status: 'passed',
          detail: 'Product App Runtime host observation remains a separate preview gate.',
        },
      ],
      summary: { failed: 0, warnings: 0 },
    }, {
      workId: 'work-1',
      turnId: 'turn-1',
      runtimeContext,
      componentId: 'interactive-runtime',
      observedAt: 42,
    });

    expect(preview).toMatchObject({
      id: 'preview:capability:runtime',
      kind: 'capability',
      status: 'passed',
      source: 'preview-harness',
      harnessMode: 'capability',
      triggerTurnId: 'turn-1',
      workId: 'work-1',
      runtimeInstanceId: 'runtime-1',
      productAppId: 'app-1',
      productAppSurfaceId: 'surface-1',
      surfaceId: 'primary',
      observedAt: 42,
      issueCount: 0,
      fatalIssueCount: 0,
      warningIssueCount: 0,
    });
    expect(preview.checks).toEqual([
      {
        id: 'capabilityCall',
        status: 'passed',
        detail: 'Interactive surface runtime runtime://interactive-surface resolved.',
      },
      {
        id: 'capabilityLogs',
        status: 'passed',
        detail: 'Product App Runtime host observation remains a separate preview gate.',
      },
    ]);
  });

  it('derives issue counts when RunStudioPreview summary is absent', () => {
    const preview = buildWorkStudioPreviewResultFromToolResult({
      status: 'notVerified',
      kind: 'release-rehearsal',
      source: 'preview-harness',
      harness_mode: 'release-rehearsal',
      app_id: 'app-1',
      checks: [
        { id: 'criticalPath', status: 'notVerified', detail: 'Runner not executed.' },
        { id: 'permissions', status: 'warning', detail: 'Permission review needed.' },
        { id: 'releaseGate', status: 'blocked', detail: 'Release is blocked.' },
      ],
    }, {
      workId: 'work-1',
      productAppId: 'app-1',
      observedAt: 64,
    });

    expect(preview).toMatchObject({
      id: 'preview:release-rehearsal:app-1',
      kind: 'release-rehearsal',
      status: 'notVerified',
      source: 'preview-harness',
      harnessMode: 'release-rehearsal',
      workId: 'work-1',
      productAppId: 'app-1',
      observedAt: 64,
      issueCount: 2,
      fatalIssueCount: 1,
      warningIssueCount: 1,
    });
  });

  it('keeps Agent Eval preview results separate from release rehearsal', () => {
    const preview = buildWorkStudioPreviewResultFromToolResult({
      status: 'passed',
      previewResultId: 'preview:agent-eval:app-1',
      kind: 'agent-eval',
      source: 'preview-harness',
      harnessMode: 'agent-eval',
      appId: 'app-1',
      checks: [
        { id: 'agentEval', status: 'passed', detail: 'Agent Eval executed 2 case(s).' },
      ],
      summary: { failed: 0, warnings: 0 },
    }, {
      workId: 'work-1',
      productAppId: 'app-1',
      observedAt: 80,
    });

    expect(preview).toMatchObject({
      id: 'preview:agent-eval:app-1',
      kind: 'agent-eval',
      harnessMode: 'agent-eval',
      issueCount: 0,
      fatalIssueCount: 0,
      warningIssueCount: 0,
    });
  });

  it('preserves concrete release-readiness harness kinds', () => {
    const preview = buildWorkStudioPreviewResultFromToolResult({
      status: 'passed',
      previewResultId: 'preview:runtime-boundary:app-1',
      kind: 'runtime-boundary',
      source: 'preview-harness',
      harnessMode: 'runtime-boundary',
      appId: 'app-1',
      checks: [
        { id: 'runtimeStorage', status: 'passed', detail: 'Storage scope resolved.' },
      ],
      summary: { failed: 0, warnings: 0 },
    }, {
      workId: 'work-1',
      productAppId: 'app-1',
      observedAt: 90,
    });

    expect(preview).toMatchObject({
      id: 'preview:runtime-boundary:app-1',
      kind: 'runtime-boundary',
      harnessMode: 'runtime-boundary',
      issueCount: 0,
    });
  });
});
