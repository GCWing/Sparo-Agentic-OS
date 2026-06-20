/**
 * Goal mode spec: verifies the /goal path creates a durable session goal and
 * that the judge-driven loop owns the lifecycle. Completion is decided by the
 * per-turn judge (never claimed by the agent), so this spec drives the
 * deterministic e2e judge through the user-facing controls:
 *   - a goal whose objective lacks the `e2e-pass` sentinel keeps "continuing"
 *     and exposes remaining gaps,
 *   - a goal whose objective contains `e2e-pass` is judged "pass" and completes.
 */

import { browser, expect, $, $$ } from '@wdio/globals';
import { ChatInput } from '../page-objects/components/ChatInput';

type ActiveSessionInfo = {
  sessionId: string;
  workspacePath: string;
  storageScope: string;
  profileId: string;
};

type GoalRecord = {
  goalId: string;
  revision: number;
  status: string;
  contract: {
    resolvedObjective: string;
  };
  latestExtraction?: {
    extractionId: string;
    status: string;
    intent: string;
  } | null;
  latestJudgment?: {
    judgeId: string;
    state: string;
    summary: string;
    remainingGaps: Array<{ criterionId: string; description: string }>;
    confidence: number;
  } | null;
  progress: {
    remainingGaps: Array<{ criterionId: string; description: string }>;
  };
};

type GoalResponse = {
  accepted: boolean;
  message: string;
  goal?: GoalRecord | null;
};

async function waitForTauriInvoke(): Promise<void> {
  await browser.waitUntil(
    async () => browser.execute(() => {
      const tauriInternals = (window as any).__TAURI_INTERNALS__;
      return typeof tauriInternals?.invoke === 'function';
    }),
    {
      timeout: 30000,
      timeoutMsg: 'Tauri IPC invoke is not available',
    },
  );
}

async function activateGoalTestCodeSession(info: ActiveSessionInfo): Promise<void> {
  await browser.executeAsync(
    (sessionInfo, done) => {
      (async () => {
        const { openWorkspaceSession } = await import('/src/app/navigation/workspaceNavigation.ts');
        await openWorkspaceSession(sessionInfo.sessionId);
        done(true);
      })().catch(error => {
        done(error instanceof Error ? error.message : String(error));
      });
    },
    info,
  );

  await browser.waitUntil(async () => {
    const state = await browser.execute<any>(async (sessionInfo) => {
      const { openWorkspaceSession } = await import('/src/app/navigation/workspaceNavigation.ts');
      const { useWorkspaceSurfaceStore } = await import('/src/app/navigation/workspaceSurfaceStore.ts');
      const { flowChatStore } = await import('/src/flow_chat/store/FlowChatStore.ts');

      await openWorkspaceSession(sessionInfo.sessionId);

      const flowState = flowChatStore.getState();
      const session = flowState.activeSessionId
        ? flowState.sessions.get(flowState.activeSessionId)
        : null;
      const surface = useWorkspaceSurfaceStore.getState().activeSurface;

      return {
        current: session?.sessionId && session.workspacePath
          ? {
              sessionId: session.sessionId,
              workspacePath: session.workspacePath,
              storageScope: session.storageScope || session.descriptor.storageScope,
              profileId: session.descriptor.profileId,
            }
          : null,
        surface,
      };
    }, info);
    const current = state.current;
    const surface = state.surface;
    return (
      current?.sessionId === info.sessionId &&
      current.workspacePath === info.workspacePath &&
      current.storageScope === 'workspace' &&
      current.profileId === 'coding' &&
      surface?.kind === 'session' &&
      surface?.sessionId === info.sessionId
    );
  }, {
    timeout: 20000,
    interval: 500,
    timeoutMsg: 'Goal-mode Code session did not become active in Flow Chat',
  });
}

async function ensureGoalTestCodeSession(workspacePath: string): Promise<ActiveSessionInfo> {
  const info = await browser.executeAsync<ActiveSessionInfo>(
    (targetWorkspacePath, done) => {
      (async () => {
        const { workspaceManager } = await import('/src/infrastructure/services/business/workspaceManager.ts');
        const { flowChatManager } = await import('/src/flow_chat/services/FlowChatManager.ts');
        const { flowChatStore } = await import('/src/flow_chat/store/FlowChatStore.ts');
        const { getDefaultSessionDescriptor } = await import('/src/flow_chat/domain/sessionDescriptor.ts');
        const { openWorkspaceSession } = await import('/src/app/navigation/workspaceNavigation.ts');

        const descriptor = getDefaultSessionDescriptor();
        await workspaceManager.openWorkspace(targetWorkspacePath);
        await flowChatManager.initializeWorkspaceSessionState(targetWorkspacePath, {
          preferredDescriptor: descriptor,
          createDefaultSession: false,
        });

        const state = flowChatStore.getState();
        let session = Array.from(state.sessions.values()).find(candidate =>
          candidate.workspacePath === targetWorkspacePath &&
          candidate.descriptor.profileId === 'coding'
        );

        if (!session) {
          const sessionId = await flowChatManager.createChatSession({
            workspacePath: targetWorkspacePath,
            storageScope: 'workspace',
          }, descriptor);
          session = flowChatStore.getState().sessions.get(sessionId);
        }

        if (!session?.sessionId) {
          throw new Error('Unable to create a goal-mode Code session');
        }

        await openWorkspaceSession(session.sessionId);
        done({
          sessionId: session.sessionId,
          workspacePath: targetWorkspacePath,
          storageScope: session.storageScope || session.descriptor.storageScope,
          profileId: session.descriptor.profileId,
        });
      })().catch(error => {
        done({
          sessionId: '',
          workspacePath: error instanceof Error ? error.message : String(error),
          storageScope: '',
          profileId: '',
        });
      });
    },
    workspacePath,
  );

  if (!info.sessionId) {
    throw new Error(`Failed to prepare goal-mode Code session: ${info.workspacePath}`);
  }

  await activateGoalTestCodeSession(info);

  return info;
}

async function invokeGoalControl(
  info: ActiveSessionInfo,
  action: 'clear' | 'pause' | 'resume' | 'review',
): Promise<GoalResponse | null> {
  return browser.executeAsync<GoalResponse | null>(
    (sessionInfo, requestedAction, done) => {
      (async () => {
        const invoke = (window as any).__TAURI_INTERNALS__?.invoke;
        if (typeof invoke !== 'function') {
          throw new Error('Tauri IPC invoke is not available');
        }

        const response = await invoke('control_session_goal', {
          request: {
            sessionId: sessionInfo.sessionId,
            workspacePath: sessionInfo.workspacePath,
            action: requestedAction,
          },
        });
        done(response);
      })().catch(error => {
        if (requestedAction === 'clear') {
          done(null);
          return;
        }
        done({ accepted: false, message: error instanceof Error ? error.message : String(error) });
      });
    },
    info,
    action,
  );
}

async function getGoalStatus(info: ActiveSessionInfo): Promise<GoalResponse> {
  return browser.executeAsync<GoalResponse>(
    (sessionInfo, done) => {
      (async () => {
        const invoke = (window as any).__TAURI_INTERNALS__?.invoke;
        if (typeof invoke !== 'function') {
          throw new Error('Tauri IPC invoke is not available');
        }
        const response = await invoke('get_session_goal', {
          request: {
            sessionId: sessionInfo.sessionId,
            workspacePath: sessionInfo.workspacePath,
          },
        });
        done(response);
      })().catch(error => {
        done({ accepted: false, message: error instanceof Error ? error.message : String(error) });
      });
    },
    info,
  );
}

async function bannerAttribute(name: string): Promise<string | null> {
  const banner = await $('[data-testid="active-goal-banner"]');
  return banner.getAttribute(name);
}

async function submitGoalCommand(
  chatInput: ChatInput,
  info: ActiveSessionInfo,
  command: string,
): Promise<void> {
  await activateGoalTestCodeSession(info);
  await chatInput.clear();
  await chatInput.typeMessage(command);
  await chatInput.clickSend();
}

async function findGoalMessageContaining(text: string): Promise<WebdriverIO.Element> {
  const goalMessages = await $$('.user-message-item--goal');
  for (const message of goalMessages) {
    if ((await message.getText()).includes(text)) {
      return message;
    }
  }
  throw new Error(`Goal message containing "${text}" was not found`);
}

describe('Goal mode', () => {
  const chatInput = new ChatInput();
  let activeSession: ActiveSessionInfo | null = null;

  before(async () => {
    await waitForTauriInvoke();
    activeSession = await ensureGoalTestCodeSession(process.env.E2E_TEST_WORKSPACE || process.cwd());
    await chatInput.waitForLoad();
    await activateGoalTestCodeSession(activeSession);
  });

  it('runs extraction, judge-driven continuation, and completion through the loop', async function () {
    this.timeout(180000);

    await chatInput.waitForLoad();
    if (!activeSession) {
      throw new Error('Goal mode test did not prepare an active session');
    }
    await activateGoalTestCodeSession(activeSession);

    // Start from a clean slate.
    await invokeGoalControl(activeSession, 'clear');
    await browser.waitUntil(async () => !(await $('[data-testid="active-goal-banner"]').isExisting()), {
      timeout: 5000,
      interval: 250,
      timeoutMsg: 'Previous goal banner did not clear before goal-mode test',
    }).catch(() => undefined);

    // --- Create a goal that should keep continuing (no e2e-pass sentinel). ---
    const objective = `E2E goal judge loop ${Date.now()}`;
    await submitGoalCommand(chatInput, activeSession, `/goal ${objective}`);

    await browser.waitUntil(async () => {
      const scene = await $('.sparo-session-scene');
      const phase = await scene.getAttribute('data-goal-phase');
      return phase !== null && phase !== 'none';
    }, {
      timeout: 10000,
      interval: 250,
      timeoutMsg: 'Session scene did not enter goal mode after /goal command',
    });
    const sessionScene = await $('.sparo-session-scene');
    expect((await sessionScene.getAttribute('class')) ?? '').toContain('sparo-session-scene--goal-mode');

    const banner = await $('[data-testid="active-goal-banner"]');
    await banner.waitForExist({
      timeout: 15000,
      interval: 500,
      timeoutMsg: 'Active goal banner did not appear after /goal command',
    });

    const objectiveText = await $('[data-testid="active-goal-objective"]').getText();
    expect(objectiveText).toContain(objective);

    // Header control mirrors the goal phase + extraction status.
    const headerGoalButton = await $('[data-testid="flowchat-header-goal"]');
    await headerGoalButton.waitForExist({
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'Goal header control did not appear after /goal command',
    });
    expect(await headerGoalButton.getAttribute('data-goal-phase')).not.toBe('none');
    await headerGoalButton.click();
    const headerGoalPanel = await $('[data-testid="flowchat-header-goal-panel"]');
    await headerGoalPanel.waitForExist({
      timeout: 5000,
      interval: 250,
      timeoutMsg: 'Goal header panel did not open',
    });
    expect(await headerGoalPanel.getText()).toContain(objective);
    await headerGoalButton.click();

    // The first goal turn renders with Goal styling and the bare objective
    // (no slash command, no injected steering text).
    await browser.waitUntil(async () => {
      const goalMessages = await $$('.user-message-item--goal');
      return goalMessages.length > 0;
    }, {
      timeout: 15000,
      interval: 500,
      timeoutMsg: 'Goal-sourced first turn did not render with Goal styling',
    });
    const goalFirstTurnMessage = await findGoalMessageContaining(objective);
    expect(await goalFirstTurnMessage.getAttribute('data-source-label')).toBe('Goal');
    const goalFirstTurnText = await goalFirstTurnMessage.getText();
    expect(goalFirstTurnText).toContain(objective);
    expect(goalFirstTurnText).not.toContain('/goal');

    // Extraction settles as accepted.
    await browser.waitUntil(async () => (await bannerAttribute('data-extraction-status')) === 'accepted', {
      timeout: 15000,
      interval: 500,
      timeoutMsg: 'Goal extraction status did not become accepted',
    });
    expect(await headerGoalButton.getAttribute('data-extraction-status')).toBe('accepted');

    // --- Control surface: status / pause. ---
    await submitGoalCommand(chatInput, activeSession, '/goal status');

    await submitGoalCommand(chatInput, activeSession, '/goal pause');
    await browser.waitUntil(async () => (await bannerAttribute('data-status')) === 'paused', {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'Goal did not enter paused state',
    });

    // Resume hands control back to the loop (active again, then it may re-judge).
    const resumeButton = await $('[data-testid="active-goal-resume"]');
    await resumeButton.click();
    await browser.waitUntil(async () => (await bannerAttribute('data-status')) !== 'paused', {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'Goal did not resume through the GUI control',
    });

    // A user-triggered review runs the judge immediately. Without the sentinel
    // the deterministic judge returns "continue" with a remaining gap.
    const reviewButton = await $('[data-testid="active-goal-review"]');
    await reviewButton.click();
    await browser.waitUntil(async () => (await bannerAttribute('data-judge-status')) === 'continue', {
      timeout: 15000,
      interval: 500,
      timeoutMsg: 'Goal review did not produce a continue judgment',
    });
    const gap = await $('[data-testid="active-goal-gap"]');
    await gap.waitForExist({
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'Goal judge did not expose remaining gaps',
    });

    const continueStatus = await getGoalStatus(activeSession);
    expect(continueStatus.goal?.latestJudgment?.state).toBe('continue');
    expect((continueStatus.goal?.progress.remainingGaps.length ?? 0)).toBeGreaterThan(0);

    // --- Completion: a sentinel objective is judged "pass". ---
    const passObjective = `E2E goal complete e2e-pass ${Date.now()}`;
    await submitGoalCommand(chatInput, activeSession, `/goal ${passObjective}`);

    await browser.waitUntil(async () => {
      const text = await $('[data-testid="active-goal-objective"]').getText();
      return text.includes('e2e-pass');
    }, {
      timeout: 15000,
      interval: 500,
      timeoutMsg: 'Goal objective did not update to the sentinel goal',
    });
    await browser.waitUntil(async () => (await bannerAttribute('data-extraction-status')) === 'accepted', {
      timeout: 15000,
      interval: 500,
      timeoutMsg: 'Sentinel goal extraction did not become accepted',
    });

    // Drive an immediate judge run; the sentinel objective passes and the loop
    // marks the goal completed.
    const passReviewButton = await $('[data-testid="active-goal-review"]');
    await passReviewButton.click();
    await browser.waitUntil(async () => (await bannerAttribute('data-status')) === 'completed', {
      timeout: 15000,
      interval: 500,
      timeoutMsg: 'Goal did not complete after a passing judge verdict',
    });
    await browser.waitUntil(async () => (await bannerAttribute('data-judge-status')) === 'pass', {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'Goal judge did not show pass after completion',
    });

    const completedStatus = await getGoalStatus(activeSession);
    expect(completedStatus.goal?.status).toBe('completed');
    expect(completedStatus.goal?.latestJudgment?.state).toBe('pass');

    // --- Clear tears down goal mode. ---
    const clearButton = await $('[data-testid="active-goal-clear"]');
    await clearButton.click();
    await browser.waitUntil(async () => !(await $('[data-testid="active-goal-banner"]').isExisting()), {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'Goal banner remained after clear action',
    });
    await browser.waitUntil(async () => {
      const scene = await $('.sparo-session-scene');
      return (await scene.getAttribute('data-goal-phase')) === 'none';
    }, {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'Session scene remained in goal mode after clear action',
    });
  });
});
