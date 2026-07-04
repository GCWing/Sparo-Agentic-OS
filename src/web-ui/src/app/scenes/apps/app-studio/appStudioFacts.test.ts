import { describe, expect, it } from 'vitest';
import type { ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';
import type { ProductAppRuntimeContext } from '@/shared/types/product-app-runtime';
import type { WorkExecutionGraph } from '@/app/agentic-os/work/domain/workTypes';
import {
  buildAppStudioFacts,
  issuesFromExecutionGraph,
  logsFromExecutionGraph,
  mergeStudioIssues,
  normalizeProductAppValidationSummary,
  normalizeRuntimeIssueEvent,
  previewResultsFromExecutionGraph,
  validationSummaryFromExecutionGraph,
} from './appStudioFacts';

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

const graph: WorkExecutionGraph = {
  workId: 'work-1',
  updatedAt: 1234,
  executions: [],
  runtimeInstances: [],
  artifacts: [],
  issues: [{
    runtimeInstanceId: 'runtime-1',
    productAppId: 'app-1',
    componentId: 'surface-1',
    severity: 'fatal',
    message: 'Preview crashed',
    source: 'ui.js:12',
    category: 'runtime',
    timestampMs: 100,
  }],
  logs: [{
    runtimeInstanceId: 'runtime-1',
    productAppId: 'app-1',
    componentId: 'surface-1',
    level: 'error',
    category: 'runtime',
    message: 'Unhandled exception',
    source: 'ui.js:12',
    timestampMs: 101,
  }],
  studioPreviewResults: [],
  studioValidationResults: [],
  studioIssues: [],
  summary: {
    executionCount: 1,
    runtimeInstanceCount: 1,
    runtimeRunCount: 2,
    artifactCount: 3,
    issueCount: 1,
    errorCount: 1,
    warningCount: 0,
    lastActivityAt: 101,
  },
};

const productApp = {
  id: 'app-1',
  version: '1.0.0',
  name: 'Sample App',
  description: 'Does useful work',
  goal: 'Do useful work',
  interactionModel: 'interactiveWorkspace',
  primarySurface: { componentId: 'surface-1', surfaceId: 'primary' },
  primarySurfaceMode: 'immersivePrimary',
  components: [{ componentId: 'agent-1', kind: 'agent', source: 'private', role: 'assistant' }],
  dataLifecycle: {
    retention: 'workRuntimeScoped',
    deletion: 'deleteWithWork',
    migration: 'notSupported',
    share: 'excludeRuntimePrivateData',
  },
  componentLockId: 'sha256:lock',
  componentLockDigest: 'sha256:lock',
  permissions: {},
  installScope: 'system',
  catalogVisibility: 'installedOnly',
  enabled: true,
} as ProductAppCatalogEntry;

describe('appStudioFacts', () => {
  it('restores runtime diagnostics from Work execution graph', () => {
    const graphIssues = issuesFromExecutionGraph(graph, runtimeContext);
    const graphLogs = logsFromExecutionGraph(graph, runtimeContext);

    expect(graphIssues).toHaveLength(1);
    expect(graphIssues[0]).toMatchObject({
      origin: 'work-execution-graph',
      runtimeInstanceId: 'runtime-1',
      productAppId: 'app-1',
      componentId: 'surface-1',
      severity: 'fatal',
    });
    expect(graphLogs).toHaveLength(1);
    expect(graphLogs[0]).toMatchObject({
      origin: 'work-execution-graph',
      runtimeInstanceId: 'runtime-1',
      level: 'error',
    });
  });

  it('deduplicates graph and live event issues while preserving live origin', () => {
    const eventIssue = normalizeRuntimeIssueEvent({
      appId: 'runtime-1',
      severity: 'fatal',
      message: 'Preview crashed',
      source: 'ui.js:12',
      category: 'runtime',
      timestampMs: 100,
    }, runtimeContext);

    const merged = mergeStudioIssues(
      issuesFromExecutionGraph(graph, runtimeContext),
      eventIssue ? [eventIssue] : [],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].origin).toBe('runtime-event');
    expect(merged[0].id).toContain('studio-issue:');
  });

  it('normalizes validation tool results into facts', () => {
    const summary = normalizeProductAppValidationSummary({
      status: 'warning',
      app_id: 'app-1',
      summary: { failed: 0, warnings: 1 },
      checks: [
        { id: 'package', status: 'passed', detail: 'ok' },
        { id: 'preview', status: 'notRun', detail: 'preview is separate' },
      ],
    });

    expect(summary).toMatchObject({
      status: 'warning',
      failed: 0,
      warnings: 1,
      source: 'tool',
    });
    expect(summary?.checks.map(check => check.id)).toEqual(['package', 'preview']);
  });

  it('does not infer validation passed from missing status and incomplete checks', () => {
    const summary = normalizeProductAppValidationSummary({
      app_id: 'app-1',
      checks: [
        { id: 'package', status: 'passed', detail: 'ok' },
        { id: 'runtimeDependencies', status: 'notVerified', detail: 'host evidence missing' },
      ],
    });

    expect(summary).toMatchObject({
      status: 'notVerified',
      failed: 0,
      warnings: 0,
      source: 'tool',
    });
  });

  it('normalizes Component package validation results into facts', () => {
    const summary = normalizeProductAppValidationSummary({
      status: 'warning',
      component_id: 'shared-agent',
      componentKind: 'agents',
      summary: { failed: 0, warnings: 1 },
      checks: [
        { id: 'componentContract', status: 'passed', detail: 'contract exists' },
        { id: 'implementation', status: 'warning', detail: 'implementationRef missing' },
        { id: 'consumerCompatibility', status: 'notVerified', detail: 'no consumer yet' },
      ],
    });

    expect(summary).toMatchObject({
      status: 'warning',
      failed: 0,
      warnings: 1,
      source: 'tool',
    });
    expect(summary?.checks.map(check => check.id)).toEqual([
      'componentContract',
      'implementation',
      'consumerCompatibility',
    ]);
  });

  it('prefers core Studio issues and preview results from Work graph', () => {
    const graphWithStudioFacts: WorkExecutionGraph = {
      ...graph,
      studioPreviewResults: [{
        id: 'preview:runtime-1',
        kind: 'product-app-preview',
        status: 'failed',
        source: 'runtime-fact',
        harnessMode: 'product-app-preview',
        detail: 'Derived from runtime issues and logs.',
        workId: 'work-1',
        runtimeInstanceId: 'runtime-1',
        productAppId: 'app-1',
        productAppSurfaceId: 'surface-1',
        surfaceId: 'primary',
        observedAt: 200,
        issueCount: 1,
        fatalIssueCount: 1,
        warningIssueCount: 0,
      }],
      studioValidationResults: [],
      studioIssues: [
        {
          id: 'studio-issue:open',
          appId: 'app-1',
          productAppId: 'app-1',
          componentId: 'surface-1',
          runtimeInstanceId: 'runtime-1',
          previewResultId: 'preview:runtime-1',
          severity: 'fatal',
          status: 'open',
          message: 'Core issue',
          source: 'ui.js:20',
          category: 'runtime',
          timestampMs: 200,
          origin: 'work-execution-graph',
        },
        {
          id: 'studio-issue:fixed',
          appId: 'app-1',
          productAppId: 'app-1',
          componentId: 'surface-1',
          runtimeInstanceId: 'runtime-1',
          previewResultId: 'preview:runtime-1',
          severity: 'fatal',
          status: 'fixed',
          message: 'Already fixed',
          source: 'ui.js:10',
          category: 'runtime',
          timestampMs: 100,
          origin: 'work-execution-graph',
          resolvedAt: 220,
        },
      ],
    };

    const facts = buildAppStudioFacts({
      productApp,
      hostSurface: null,
      previewTarget: null,
      runtimeContext,
      executionGraph: graphWithStudioFacts,
      sourceFileCount: 4,
      permissionSummary: null,
      runtimeHasAttention: false,
      issues: issuesFromExecutionGraph(graphWithStudioFacts, runtimeContext),
      logs: logsFromExecutionGraph(graphWithStudioFacts, runtimeContext),
      validationSummary: null,
      observedAt: 222,
      packageRoot: 'D:/apps/app-1/1.0.0',
    });

    expect(facts.issues).toHaveLength(1);
    expect(facts.issues[0]).toMatchObject({
      id: 'studio-issue:open',
      status: 'open',
      message: 'Core issue',
    });
    expect(facts.previewResults).toHaveLength(1);
    expect(facts.previewResults[0]).toMatchObject({
      id: 'preview:runtime-1',
      productAppSurfaceId: 'surface-1',
      surfaceId: 'primary',
      status: 'failed',
    });
  });

  it('keeps blocked preview facts without runtime identity', () => {
    const graphWithBlockedPreview: WorkExecutionGraph = {
      ...graph,
      studioPreviewResults: [{
        id: 'preview:work-1:runtime-resolve',
        kind: 'product-app-preview',
        status: 'blocked',
        source: 'preview-harness',
        harnessMode: 'product-app-preview',
        detail: 'Preview runtime-resolve failed before runtime identity was available.',
        workId: 'work-1',
        runtimeInstanceId: null,
        productAppId: 'app-1',
        productAppSurfaceId: 'surface-1',
        surfaceId: 'primary',
        observedAt: 220,
        issueCount: 1,
        fatalIssueCount: 1,
        warningIssueCount: 0,
      }],
      studioValidationResults: [],
      studioIssues: [{
        id: 'studio-issue:preview:work-1:runtime-resolve',
        appId: 'app-1',
        productAppId: 'app-1',
        componentId: 'surface-1',
        runtimeInstanceId: null,
        previewResultId: 'preview:work-1:runtime-resolve',
        severity: 'fatal',
        status: 'open',
        message: 'Preview runtime-resolve failed before runtime identity was available.',
        source: 'preview-harness',
        category: 'preview:product-app-preview',
        timestampMs: 220,
        origin: 'preview',
      }],
    };

    const graphIssues = issuesFromExecutionGraph(graphWithBlockedPreview, runtimeContext);
    const graphPreviews = previewResultsFromExecutionGraph(graphWithBlockedPreview, runtimeContext);

    expect(graphIssues).toHaveLength(1);
    expect(graphIssues[0]).toMatchObject({
      origin: 'preview',
      previewResultId: 'preview:work-1:runtime-resolve',
      runtimeInstanceId: undefined,
      status: 'open',
    });
    expect(graphPreviews).toHaveLength(1);
    expect(graphPreviews[0]).toMatchObject({
      id: 'preview:work-1:runtime-resolve',
      status: 'blocked',
      runtimeInstanceId: undefined,
      productAppId: 'app-1',
    });
  });

  it('prefers core Studio validation results from Work graph', () => {
    const graphWithValidation: WorkExecutionGraph = {
      ...graph,
      studioValidationResults: [{
        id: 'validation:product-app:app-1',
        toolName: 'ValidateProductAppPackage',
        targetKind: 'product-app',
        status: 'failed',
        workId: 'work-1',
        appId: 'app-1',
        observedAt: 300,
        failedCount: 1,
        warningCount: 0,
        checks: [
          { id: 'package', status: 'passed', detail: 'Package exists.' },
          { id: 'releaseGate', status: 'failed', detail: 'Preview is failing.' },
        ],
      }],
    };

    const summary = validationSummaryFromExecutionGraph(graphWithValidation, productApp, null);
    expect(summary).toMatchObject({
      status: 'failed',
      failed: 1,
      source: 'work-graph',
      updatedAt: 300,
    });

    const facts = buildAppStudioFacts({
      productApp,
      hostSurface: null,
      previewTarget: null,
      runtimeContext,
      executionGraph: graphWithValidation,
      sourceFileCount: 4,
      permissionSummary: null,
      runtimeHasAttention: false,
      issues: [],
      logs: [],
      validationSummary: null,
      observedAt: 333,
      packageRoot: 'D:/apps/app-1/1.0.0',
    });

    expect(facts.validationSummary?.source).toBe('work-graph');
    expect(facts.validationSummary?.checks.map(check => check.id)).toEqual(['package', 'releaseGate']);
    expect(facts.versionSummary?.releaseStatus).toBe('blocked');
  });

  it('uses release rehearsal preview fact for release status', () => {
    const graphWithReleaseRehearsal: WorkExecutionGraph = {
      ...graph,
      issues: [],
      logs: [],
      studioPreviewResults: [{
        id: 'preview:release-rehearsal:work-1',
        kind: 'release-rehearsal',
        status: 'passed',
        source: 'release-rehearsal',
        harnessMode: 'release-rehearsal',
        detail: 'Release rehearsal passed current validation, preview, and issue gates.',
        checks: [
          { id: 'validation', status: 'passed', detail: 'Package validation evidence is recorded.' },
          { id: 'preview', status: 'passed', detail: 'Preview evidence is recorded.' },
          { id: 'issues', status: 'passed', detail: '0 fatal issue(s), 0 warning issue(s).' },
          { id: 'criticalPath', status: 'passed', detail: 'Critical path rehearsal passed.' },
          { id: 'permissions', status: 'passed', detail: 'Permission boundary passed.' },
          { id: 'data', status: 'passed', detail: 'Data boundary passed.' },
          { id: 'dataLifecycle', status: 'passed', detail: 'Data lifecycle passed.' },
          { id: 'dataSummary', status: 'passed', detail: 'Data summary passed.' },
          { id: 'runtimeStorage', status: 'passed', detail: 'Runtime storage scope passed.' },
          { id: 'runtimeDependencies', status: 'passed', detail: 'Runtime dependency health passed.' },
          { id: 'agentEval', status: 'passed', detail: 'Agent eval passed.' },
          { id: 'userPath', status: 'passed', detail: 'User path rehearsal passed.' },
          { id: 'releaseGate', status: 'passed', detail: 'Release gate validation check is recorded.' },
        ],
        workId: 'work-1',
        runtimeInstanceId: null,
        productAppId: 'app-1',
        productAppSurfaceId: null,
        surfaceId: null,
        observedAt: 360,
        issueCount: 0,
        fatalIssueCount: 0,
        warningIssueCount: 0,
      }],
      studioValidationResults: [{
        id: 'validation:product-app:app-1',
        toolName: 'ValidateProductAppPackage',
        targetKind: 'product-app',
        status: 'passed',
        workId: 'work-1',
        appId: 'app-1',
        observedAt: 350,
        failedCount: 0,
        warningCount: 0,
        checks: [
          { id: 'package', status: 'passed', detail: 'Package exists.' },
          { id: 'releaseGate', status: 'passed', detail: 'Release gate passed.' },
        ],
      }],
      studioIssues: [],
    };

    const facts = buildAppStudioFacts({
      productApp,
      hostSurface: null,
      previewTarget: null,
      runtimeContext,
      executionGraph: graphWithReleaseRehearsal,
      sourceFileCount: 4,
      permissionSummary: null,
      runtimeHasAttention: false,
      issues: issuesFromExecutionGraph(graphWithReleaseRehearsal, runtimeContext),
      logs: [],
      validationSummary: null,
      observedAt: 370,
      packageRoot: 'D:/apps/app-1/1.0.0',
    });

    expect(facts.previewResults.some(preview => preview.kind === 'release-rehearsal')).toBe(true);
    expect(facts.previewResults.find(preview => preview.kind === 'release-rehearsal')?.checks?.map(check => check.id)).toEqual([
      'validation',
      'preview',
      'issues',
      'criticalPath',
      'permissions',
      'data',
      'dataLifecycle',
      'dataSummary',
      'runtimeStorage',
      'runtimeDependencies',
      'agentEval',
      'userPath',
      'releaseGate',
    ]);
    expect(facts.versionSummary?.releaseStatus).toBe('passed');
  });

  it('does not promote release rehearsal without checks to release passed', () => {
    const graphWithWeakReleaseRehearsal: WorkExecutionGraph = {
      ...graph,
      issues: [],
      logs: [],
      studioPreviewResults: [{
        id: 'preview:release-rehearsal:work-1',
        kind: 'release-rehearsal',
        status: 'passed',
        source: 'release-rehearsal',
        harnessMode: 'release-rehearsal',
        detail: 'Release rehearsal summary claims passed without checklist evidence.',
        checks: [],
        workId: 'work-1',
        runtimeInstanceId: null,
        productAppId: 'app-1',
        productAppSurfaceId: null,
        surfaceId: null,
        observedAt: 360,
        issueCount: 0,
        fatalIssueCount: 0,
        warningIssueCount: 0,
      }],
      studioValidationResults: [],
      studioIssues: [],
    };

    const facts = buildAppStudioFacts({
      productApp,
      hostSurface: null,
      previewTarget: null,
      runtimeContext,
      executionGraph: graphWithWeakReleaseRehearsal,
      sourceFileCount: 4,
      permissionSummary: null,
      runtimeHasAttention: false,
      issues: [],
      logs: [],
      validationSummary: null,
      observedAt: 370,
      packageRoot: 'D:/apps/app-1/1.0.0',
    });

    expect(facts.versionSummary?.releaseStatus).toBe('notVerified');
  });

  it('does not treat release rehearsal readiness summary as executable Agent Eval', () => {
    const productAppWithEval = {
      ...productApp,
      evalPlan: {
        version: 1,
        cases: [{ id: 'case-1', title: 'Case 1' }],
      },
    } as ProductAppCatalogEntry;
    const graphWithReleaseRehearsal: WorkExecutionGraph = {
      ...graph,
      issues: [],
      logs: [],
      studioPreviewResults: [{
        id: 'preview:release-rehearsal:work-1',
        kind: 'release-rehearsal',
        status: 'passed',
        source: 'release-rehearsal',
        harnessMode: 'release-rehearsal',
        detail: 'Release rehearsal passed current validation, preview, and issue gates.',
        checks: [
          { id: 'agentEval', status: 'passed', detail: 'Release readiness recorded Agent Eval evidence.' },
          { id: 'releaseGate', status: 'passed', detail: 'Release gate validation check is recorded.' },
        ],
        workId: 'work-1',
        runtimeInstanceId: null,
        productAppId: 'app-1',
        productAppSurfaceId: null,
        surfaceId: null,
        observedAt: 360,
        issueCount: 0,
        fatalIssueCount: 0,
        warningIssueCount: 0,
      }],
      studioValidationResults: [],
      studioIssues: [],
    };

    const facts = buildAppStudioFacts({
      productApp: productAppWithEval,
      hostSurface: null,
      previewTarget: null,
      runtimeContext,
      executionGraph: graphWithReleaseRehearsal,
      sourceFileCount: 4,
      permissionSummary: null,
      runtimeHasAttention: false,
      issues: [],
      logs: [],
      validationSummary: null,
      observedAt: 370,
      packageRoot: 'D:/apps/app-1/1.0.0',
    });

    expect(facts.evalSummary).toMatchObject({
      status: 'notVerified',
      caseCount: 1,
    });
    expect(facts.evalSummary.detail).toContain('executable Agent Eval has not been recorded');
  });

  it('preserves durable release artifact facts from session metadata', () => {
    const facts = buildAppStudioFacts({
      productApp,
      hostSurface: null,
      previewTarget: null,
      runtimeContext,
      executionGraph: null,
      sourceFileCount: 4,
      permissionSummary: null,
      runtimeHasAttention: false,
      issues: [],
      logs: [],
      validationSummary: null,
      persistedFacts: {
        subject: {
          kind: 'product-app',
          appId: 'app-1',
          version: '1.0.0',
          packageRoot: 'D:/apps/app-1/1.0.0',
        },
        previewResults: [],
        issues: [],
        versionSummary: {
          latestRelease: {
            releaseId: 'release-app-1',
            artifactUri: 'product-app://app-1@1.0.0/releases/release-app-1',
            packageDigest: 'sha256:release-package',
            componentLockDigest: 'sha256:lock',
            label: 'Stable release',
            notes: 'Rollback target.',
          },
          latestPublishedRelease: {
            releaseId: 'release-app-1',
            artifactUri: 'product-app://app-1@1.0.0/releases/release-app-1',
            packageDigest: 'sha256:release-package',
            componentLockDigest: 'sha256:lock',
            publishedAt: 123,
          },
          releaseCount: 1,
        },
        shareSummary: {
          visibility: 'catalogSource',
          installLocation: 'system',
          privateDataExcluded: true,
          latestReleaseId: 'release-app-1',
          catalogStatus: 'discoverable',
        },
      },
      observedAt: 123,
      packageRoot: 'D:/apps/app-1/1.0.0',
    });

    expect(facts.versionSummary?.latestRelease?.releaseId).toBe('release-app-1');
    expect(facts.versionSummary?.latestRelease?.notes).toBe('Rollback target.');
    expect(facts.versionSummary?.latestPublishedRelease?.publishedAt).toBe(123);
    expect(facts.versionSummary?.releaseCount).toBe(1);
    expect(facts.shareSummary?.visibility).toBe('catalogSource');
    expect(facts.shareSummary?.latestReleaseId).toBe('release-app-1');
    expect(facts.shareSummary?.privateDataExcluded).toBe(true);
  });

  it('uses matching release artifact facts for private data exclusion evidence', () => {
    const facts = buildAppStudioFacts({
      productApp,
      hostSurface: null,
      previewTarget: null,
      runtimeContext,
      executionGraph: null,
      sourceFileCount: 4,
      permissionSummary: null,
      runtimeHasAttention: false,
      issues: [],
      logs: [],
      validationSummary: null,
      persistedFacts: {
        subject: {
          kind: 'product-app',
          appId: 'app-1',
          version: '1.0.0',
          packageRoot: 'D:/apps/app-1/1.0.0',
        },
        previewResults: [],
        issues: [],
        versionSummary: {
          latestRelease: {
            releaseId: 'release-app-1',
            privateDataExcluded: true,
          },
        },
      },
      observedAt: 123,
      packageRoot: 'D:/apps/app-1/1.0.0',
    });

    expect(facts.shareSummary?.privateDataExcluded).toBe(true);
  });

  it('does not preserve durable release artifact facts for a different subject', () => {
    const facts = buildAppStudioFacts({
      productApp,
      hostSurface: null,
      previewTarget: null,
      runtimeContext,
      executionGraph: null,
      sourceFileCount: 4,
      permissionSummary: null,
      runtimeHasAttention: false,
      issues: [],
      logs: [],
      validationSummary: null,
      persistedFacts: {
        subject: {
          kind: 'product-app',
          appId: 'other-app',
          version: '1.0.0',
          packageRoot: 'D:/apps/other-app/1.0.0',
        },
        previewResults: [],
        issues: [],
        versionSummary: {
          latestRelease: {
            releaseId: 'release-other-app',
          },
          releaseCount: 1,
        },
        shareSummary: {
          visibility: 'catalogSource',
          installLocation: 'system',
          privateDataExcluded: true,
          latestReleaseId: 'release-other-app',
        },
      },
      observedAt: 123,
      packageRoot: 'D:/apps/app-1/1.0.0',
    });

    expect(facts.versionSummary?.latestRelease).toBeUndefined();
    expect(facts.versionSummary?.releaseCount).toBeUndefined();
    expect(facts.shareSummary?.visibility).toBe('privateDraft');
    expect(facts.shareSummary?.latestReleaseId).toBeUndefined();
    expect(facts.shareSummary?.privateDataExcluded).toBe(false);
  });

  it('prefers core Component validation results from Work graph', () => {
    const componentSubject = {
      componentId: 'shared-agent',
      componentKind: 'agent',
      version: '1.0.0',
      packageRoot: 'D:/components/shared-agent',
      name: 'Shared Agent',
      description: 'Reusable app agent',
    };
    const graphWithValidation: WorkExecutionGraph = {
      ...graph,
      workId: 'work-component-1',
      studioPreviewResults: [{
        id: 'preview:capability:component:agent:shared-agent',
        kind: 'capability',
        status: 'warning',
        source: 'preview-harness',
        harnessMode: 'capability',
        detail: 'Capability preview for shared-agent has warning checks: agentEval.',
        checks: [
          { id: 'componentContract', status: 'passed', detail: 'Contract exists.' },
          { id: 'capabilities', status: 'passed', detail: 'Capabilities are declared.' },
          { id: 'agentEval', status: 'warning', detail: 'Representative eval has not passed yet.' },
        ],
        workId: 'work-component-1',
        runtimeInstanceId: null,
        productAppId: null,
        productAppSurfaceId: null,
        surfaceId: null,
        observedAt: 405,
        issueCount: 1,
        fatalIssueCount: 0,
        warningIssueCount: 1,
      }],
      studioValidationResults: [{
        id: 'validation:component:agent:shared-agent',
        toolName: 'ValidateComponentPackage',
        targetKind: 'component',
        status: 'warning',
        workId: 'work-component-1',
        appId: null,
        componentId: 'shared-agent',
        componentKind: 'agent',
        version: '1.0.0',
        packageRoot: 'D:/components/shared-agent',
        observedAt: 400,
        failedCount: 0,
        warningCount: 1,
        checks: [
          { id: 'componentContract', status: 'passed', detail: 'Contract exists.' },
          { id: 'consumerCompatibility', status: 'warning', detail: 'No consumer app verified.' },
        ],
      }],
    };

    const summary = validationSummaryFromExecutionGraph(graphWithValidation, null, componentSubject);
    expect(summary).toMatchObject({
      status: 'warning',
      failed: 0,
      warnings: 1,
      source: 'work-graph',
      updatedAt: 400,
    });

    const facts = buildAppStudioFacts({
      productApp: null,
      componentSubject,
      hostSurface: null,
      previewTarget: null,
      runtimeContext: null,
      executionGraph: graphWithValidation,
      sourceFileCount: 0,
      permissionSummary: null,
      runtimeHasAttention: false,
      issues: [],
      logs: [],
      validationSummary: null,
      observedAt: 401,
      packageRoot: componentSubject.packageRoot,
    });

    expect(facts.subject).toMatchObject({
      kind: 'component',
      componentId: 'shared-agent',
      componentKind: 'agent',
    });
    expect(previewResultsFromExecutionGraph(graphWithValidation, null)).toHaveLength(1);
    expect(facts.previewResults[0]).toMatchObject({
      kind: 'capability',
      status: 'warning',
      source: 'preview-harness',
      harnessMode: 'capability',
    });
    expect(facts.previewResults[0].checks?.map(check => check.id)).toEqual([
      'componentContract',
      'capabilities',
      'agentEval',
    ]);
    expect(facts.validationSummary?.source).toBe('work-graph');
    expect(facts.validationSummary?.checks.map(check => check.id)).toEqual([
      'componentContract',
      'consumerCompatibility',
    ]);
  });

  it('preserves Component release readiness checklist from Work graph', () => {
    const componentSubject = {
      componentId: 'shared-agent',
      componentKind: 'agents',
      version: '1.0.0',
      packageRoot: 'D:/components/agents/shared-agent/1.0.0',
      name: 'Shared Agent',
      description: 'Reusable planning agent',
    };
    const graphWithComponentRelease: WorkExecutionGraph = {
      ...graph,
      workId: 'work-component-1',
      issues: [],
      logs: [],
      studioPreviewResults: [{
        id: 'preview:release-rehearsal:work-component-1',
        kind: 'release-rehearsal',
        status: 'passed',
        source: 'release-rehearsal',
        harnessMode: 'release-rehearsal',
        detail: 'Component release rehearsal passed current validation, preview, and issue gates.',
        checks: [
          { id: 'validation', status: 'passed', detail: 'Package validation evidence is recorded.' },
          { id: 'preview', status: 'passed', detail: 'Preview evidence is recorded.' },
          { id: 'issues', status: 'passed', detail: '0 fatal issue(s), 0 warning issue(s).' },
          { id: 'componentContract', status: 'passed', detail: 'Contract exists.' },
          { id: 'capabilities', status: 'passed', detail: 'Capabilities are declared.' },
          { id: 'dependencies', status: 'passed', detail: 'Only shared dependencies are declared.' },
          { id: 'implementation', status: 'passed', detail: 'implementationRef resolves.' },
          { id: 'consumerCompatibility', status: 'passed', detail: 'Consumer Product App lock validated.' },
          { id: 'permissions', status: 'passed', detail: 'Permission boundary passed.' },
          { id: 'data', status: 'passed', detail: 'Data boundary passed.' },
          { id: 'dataSummary', status: 'passed', detail: 'Consumer runtime data/share summary passed.' },
          { id: 'runtimeDependencies', status: 'passed', detail: 'Consumer runtime dependencies are current.' },
          { id: 'agentEval', status: 'passed', detail: 'Representative Component eval passed.' },
          { id: 'releaseGate', status: 'passed', detail: 'Release gate validation check is recorded.' },
        ],
        workId: 'work-component-1',
        runtimeInstanceId: null,
        productAppId: null,
        productAppSurfaceId: 'shared-agent',
        surfaceId: null,
        observedAt: 500,
        issueCount: 0,
        fatalIssueCount: 0,
        warningIssueCount: 0,
      }],
      studioValidationResults: [],
      studioIssues: [],
      summary: {
        ...graph.summary,
        issueCount: 0,
        errorCount: 0,
        warningCount: 0,
        lastActivityAt: 500,
      },
    };

    const facts = buildAppStudioFacts({
      productApp: null,
      componentSubject,
      hostSurface: null,
      previewTarget: null,
      runtimeContext: null,
      executionGraph: graphWithComponentRelease,
      sourceFileCount: 0,
      permissionSummary: null,
      runtimeHasAttention: false,
      issues: [],
      logs: [],
      validationSummary: null,
      observedAt: 501,
      packageRoot: componentSubject.packageRoot,
    });

    const releaseRehearsal = facts.previewResults.find(preview => preview.kind === 'release-rehearsal');
    expect(releaseRehearsal?.checks?.map(check => check.id)).toEqual([
      'validation',
      'preview',
      'issues',
      'componentContract',
      'capabilities',
      'dependencies',
      'implementation',
      'consumerCompatibility',
      'permissions',
      'data',
      'dataSummary',
      'runtimeDependencies',
      'agentEval',
      'releaseGate',
    ]);
    expect(facts.versionSummary?.releaseStatus).toBe('passed');
  });

  it('builds Product App facts with package root and graph-derived data summary', () => {
    const facts = buildAppStudioFacts({
      productApp,
      hostSurface: null,
      previewTarget: null,
      runtimeContext,
      executionGraph: graph,
      sourceFileCount: 4,
      permissionSummary: {
        readsWorkspace: false,
        writesWorkspace: false,
        shellEnabled: false,
        netEnabled: false,
        aiEnabled: true,
        nodeEnabled: false,
      },
      runtimeHasAttention: false,
      issues: issuesFromExecutionGraph(graph, runtimeContext),
      logs: logsFromExecutionGraph(graph, runtimeContext),
      validationSummary: null,
      observedAt: 1234,
      packageRoot: 'D:/apps/app-1/1.0.0',
    });

    expect(facts.subject).toEqual({
      kind: 'product-app',
      appId: 'app-1',
      version: '1.0.0',
      packageRoot: 'D:/apps/app-1/1.0.0',
    });
    expect(facts.dataSummary?.runtimeRunCount).toBe(2);
    expect(facts.dataSummary?.retentionPolicy).toBe('workRuntimeScoped');
    expect(facts.dataSummary?.deletionPolicy).toBe('deleteWithWork');
    expect(facts.dataSummary?.migrationPolicy).toBe('notSupported');
    expect(facts.dataSummary?.sharePolicy).toBe('excludeRuntimePrivateData');
    expect(facts.shareSummary?.privateDataExcluded).toBe(false);
    expect(facts.validationSummary?.checks.map(check => check.id)).toContain('releaseGate');
  });

  it('summarizes declared Product App eval cases and latest agent eval check', () => {
    const productAppWithEval = {
      ...productApp,
      evalPlan: {
        version: 1,
        cases: [
          { id: 'case-1', title: 'Case 1' },
          { id: 'case-2', title: 'Case 2' },
        ],
      },
    } as ProductAppCatalogEntry;
    const graphWithEval: WorkExecutionGraph = {
      ...graph,
      issues: [],
      logs: [],
      studioPreviewResults: [{
        id: 'preview:agent-eval:work-1',
        kind: 'agent-eval',
        status: 'passed',
        source: 'preview-harness',
        harnessMode: 'agent-eval',
        detail: 'Agent eval passed.',
        checks: [
          { id: 'agentEval', status: 'passed', detail: 'Product App Agent Eval executed 2 case(s).' },
          { id: 'evalLogs', status: 'passed', detail: 'Eval logs recorded.' },
        ],
        workId: 'work-1',
        runtimeInstanceId: null,
        productAppId: 'app-1',
        productAppSurfaceId: null,
        surfaceId: null,
        observedAt: 500,
        issueCount: 0,
        fatalIssueCount: 0,
        warningIssueCount: 0,
      }],
    };

    const facts = buildAppStudioFacts({
      productApp: productAppWithEval,
      hostSurface: null,
      previewTarget: null,
      runtimeContext,
      executionGraph: graphWithEval,
      sourceFileCount: 4,
      permissionSummary: null,
      runtimeHasAttention: false,
      issues: [],
      logs: [],
      validationSummary: null,
      observedAt: 501,
      packageRoot: 'D:/apps/app-1/1.0.0',
    });

    expect(facts.evalSummary).toMatchObject({
      status: 'passed',
      caseCount: 2,
      detail: 'Product App Agent Eval executed 2 case(s).',
    });
  });

  it('builds Component package facts without requiring a Product App', () => {
    const facts = buildAppStudioFacts({
      productApp: null,
      componentSubject: {
        componentId: 'shared-agent',
        componentKind: 'agents',
        version: '1.0.0',
        packageRoot: 'D:/components/agents/shared-agent/1.0.0',
        name: 'Shared Agent',
        description: 'Reusable planning agent',
      },
      hostSurface: null,
      previewTarget: null,
      runtimeContext: null,
      executionGraph: null,
      sourceFileCount: 0,
      permissionSummary: null,
      runtimeHasAttention: false,
      issues: [],
      logs: [],
      validationSummary: null,
      observedAt: 5678,
      packageRoot: null,
    });

    expect(facts.subject).toEqual({
      kind: 'component',
      componentId: 'shared-agent',
      componentKind: 'agents',
      version: '1.0.0',
      packageRoot: 'D:/components/agents/shared-agent/1.0.0',
    });
    expect(facts.componentGraph).toMatchObject({
      componentCount: 1,
      agentComponentCount: 1,
    });
    expect(facts.validationSummary?.source).toBe('derived');
    expect(facts.validationSummary?.checks.map(check => check.id)).toEqual([
      'componentContract',
      'consumerCompatibility',
      'releaseGate',
    ]);
  });
});
