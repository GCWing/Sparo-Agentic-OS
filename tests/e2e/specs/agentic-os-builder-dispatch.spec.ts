/**
 * Agentic OS Builder dispatch spec: verifies the real Dispatcher model can
 * recognize a natural-language request and create a Prime Builder WorkSession.
 */

import { browser, expect } from '@wdio/globals';

type RawWorkRecord = {
  id: string;
  kind: string;
  title: string;
  objective: string;
  status: string;
  visibility: string;
  scope: { kind: string; workspace_path?: string };
  primary_surface: { kind: string; session_id?: string; work_id?: string };
  surfaces: Array<{ kind: string; session_id?: string; work_id?: string }>;
  assignment?: { kind: string; agent_type?: string } | null;
  session_refs: Array<{ session_id: string; workspace_path?: string }>;
  execution_bindings: Array<{
    id: string;
    status: string;
    source: { source: string; session_id?: string; turn_id?: string | null };
  }>;
};

type DispatcherIntentResult = {
  dispatcher: {
    sessionId: string;
    startAccepted: boolean;
  };
  matchedWork?: {
    workId: string;
    kind: string;
    title: string;
    status: string;
    assignmentKind?: string;
    agentType?: string;
    primarySurfaceKind: string;
    hasWorkSessionSurface: boolean;
    sessionRefCount: number;
    executionBindingCount: number;
    agentSessionRunCount: number;
    agentSessionRunWithTurnIdCount: number;
  };
  cleanup: {
    cancelStatus?: string;
    archiveStatus?: string;
    dispatcherCancel?: string;
  };
  dockObserved?: boolean;
  dockObservationError?: string;
  error?: string;
};

describe('Agentic OS Builder dispatch', () => {
  before(async () => {
    await browser.waitUntil(
      async () => {
        return browser.execute(() => {
          const tauriInternals = (window as any).__TAURI_INTERNALS__;
          return typeof tauriInternals?.invoke === 'function';
        });
      },
      {
        timeout: 30000,
        timeoutMsg: 'Tauri IPC invoke is not available',
      },
    );
  });

  it('lets the real Dispatcher create a Prime Builder Work from intent', async function () {
    this.timeout(240000);
    await browser.setTimeout({ script: 240000 });

    const workspacePath = process.env.E2E_TEST_WORKSPACE || process.cwd();
    const title = `E2E Prime Builder Intent ${Date.now()}`;

    const result = await browser.executeAsync<DispatcherIntentResult>(
      (workspacePath, title, done) => {
        (async () => {
          const tauriInternals = (window as any).__TAURI_INTERNALS__;
          const invoke = tauriInternals?.invoke;

          if (typeof invoke !== 'function') {
            throw new Error('Tauri IPC invoke is not available');
          }

          const cleanup: DispatcherIntentResult['cleanup'] = {};

          let dispatcherSessionId: string | undefined;
          let dockObserved = false;
          let dockObservationError: string | undefined;

          const waitForDockWork = async (workId: string, expectedTitle: string): Promise<boolean> => {
            const openDock = () => {
              const dock = document.querySelector<HTMLElement>('[data-testid="work-dock"]');
              if (dock?.className.includes('work-dock--expanded')) {
                return;
              }

              const topBarButton = document.querySelector<HTMLElement>('[data-testid="unified-top-bar-work-list"]');
              const dockTrigger = document.querySelector<HTMLElement>('[data-testid="work-dock-trigger"]');
              (topBarButton ?? dockTrigger)?.click();
            };

            openDock();

            const startedAt = Date.now();
            while (Date.now() - startedAt < 30000) {
              openDock();
              const itemById = document.querySelector<HTMLElement>(`[data-sparo-work-id="${workId}"]`);
              if (itemById) {
                return true;
              }

              const titleNodes = Array.from(document.querySelectorAll<HTMLElement>(
                '[data-sparo-work-title], .work-list__item-label, .work-dock__running-row-title',
              ));
              if (titleNodes.some(node => (
                node.dataset.sparoWorkTitle?.includes(expectedTitle) ||
                node.textContent?.includes(expectedTitle)
              ))) {
                return true;
              }
              await new Promise(resolve => setTimeout(resolve, 500));
            }

            return false;
          };

          const dispatcherSession = await invoke('create_session', {
            request: {
              sessionName: `E2E Dispatcher Intent ${Date.now()}`,
              agentType: 'Dispatcher',
              storageScope: 'agentic_os',
              config: {
                enableTools: true,
                safeMode: true,
                storageScope: 'agentic_os',
              },
            },
          });
          dispatcherSessionId = dispatcherSession.sessionId;

            const userInput = [
              `请使用 Agentic OS 调度创建一个构造师任务，标题必须精确为 "${title}"。`,
              `这个任务属于工作区：${workspacePath}。`,
              '构造师指 Code Work / Prime Builder，也就是后端 agent_type=agentic。',
              '只能使用单一 Work 工具，并调用 action=start；不要使用 WorkMutation、WorkAdvance、WorkDispatch、AgentDispatch 或 Session 工具。',
              '初始 instructions 只要求确认任务已创建，不要修改文件。',
              '测试会验证该 Work 产生带 turn_id 的 agent_session_run 执行绑定。',
            ].join('\n');

            const startResponse = await invoke('start_dialog_turn', {
              request: {
                sessionId: dispatcherSessionId,
                userInput,
                originalUserInput: userInput,
                agentType: 'Dispatcher',
                workspacePath,
                persistAgentType: true,
              },
            });

            const startedAt = Date.now();
            let matchedWork: RawWorkRecord | undefined;
            while (Date.now() - startedAt < 180000) {
              const worksResponse = await invoke('agentic_os_list_works', {
                request: { workspace_path: workspacePath },
              });
              matchedWork = (worksResponse.works as RawWorkRecord[]).find(work => work.title === title);
              const hasRunnableBuilderWork =
                matchedWork?.assignment?.agent_type === 'agentic' &&
                matchedWork.surfaces.some(surface => surface.kind === 'work_session') &&
                matchedWork.execution_bindings.some(
                  binding => binding.source.source === 'agent_session_run' && Boolean(binding.source.turn_id),
                );
              if (hasRunnableBuilderWork) {
                break;
              }
              await new Promise(resolve => setTimeout(resolve, 2000));
            }

            if (matchedWork) {
              try {
                dockObserved = await waitForDockWork(matchedWork.id, title);
              } catch (error) {
                dockObservationError = error instanceof Error ? error.message : String(error);
              }

              try {
                const cancelResponse = await invoke('agentic_os_control_work', {
                  request: {
                    work_id: matchedWork.id,
                    action: 'cancel_current_execution',
                  },
                });
                cleanup.cancelStatus = cancelResponse.work?.status;
              } catch {
                cleanup.cancelStatus = 'not_cancelled';
              }

              try {
                const archiveResponse = await invoke('agentic_os_control_work', {
                  request: {
                    work_id: matchedWork.id,
                    action: 'archive',
                  },
                });
                cleanup.archiveStatus = archiveResponse.work?.status;
              } catch {
                cleanup.archiveStatus = 'not_archived';
              }
            }

            if (dispatcherSessionId) {
              try {
                await invoke('cancel_session', {
                  request: { sessionId: dispatcherSessionId },
                });
                cleanup.dispatcherCancel = 'cancelled';
              } catch {
                cleanup.dispatcherCancel = 'not_cancelled';
              }
            }

            const finalResult: DispatcherIntentResult = {
              dispatcher: {
                sessionId: dispatcherSessionId,
                startAccepted: Boolean(startResponse.success),
              },
              matchedWork: matchedWork
                ? {
                    workId: matchedWork.id,
                    kind: matchedWork.kind,
                    title: matchedWork.title,
                    status: matchedWork.status,
                    assignmentKind: matchedWork.assignment?.kind,
                    agentType: matchedWork.assignment?.agent_type,
                    primarySurfaceKind: matchedWork.primary_surface.kind,
                    hasWorkSessionSurface: matchedWork.surfaces.some(surface => surface.kind === 'work_session'),
                    sessionRefCount: matchedWork.session_refs.length,
                    executionBindingCount: matchedWork.execution_bindings.length,
                    agentSessionRunCount: matchedWork.execution_bindings.filter(
                      binding => binding.source.source === 'agent_session_run',
                    ).length,
                    agentSessionRunWithTurnIdCount: matchedWork.execution_bindings.filter(
                      binding => binding.source.source === 'agent_session_run' && Boolean(binding.source.turn_id),
                    ).length,
                  }
                : undefined,
              cleanup,
              dockObserved,
              dockObservationError,
            };
            done(finalResult);
        })().catch(error => {
          const finalResult: DispatcherIntentResult = {
            dispatcher: {
              sessionId: '',
              startAccepted: false,
            },
            cleanup: {},
            dockObserved: false,
            error: error instanceof Error ? error.message : String(error),
          };
          done(finalResult);
        });
      },
      workspacePath,
      title,
    );

    expect(result.error).toBeUndefined();
    expect(result.dispatcher.sessionId).toBeTruthy();
    expect(result.dispatcher.startAccepted).toBe(true);
    expect(result.matchedWork).toBeDefined();
    expect(result.matchedWork?.workId).toMatch(/^work_/);
    expect(result.matchedWork?.kind).toBe('multi_step');
    expect(result.matchedWork?.title).toBe(title);
    expect(result.matchedWork?.assignmentKind).toBe('agent');
    expect(result.matchedWork?.agentType).toBe('agentic');
    expect(result.matchedWork?.hasWorkSessionSurface).toBe(true);
    expect(result.matchedWork?.sessionRefCount).toBeGreaterThan(0);
    expect(result.matchedWork?.executionBindingCount).toBeGreaterThan(0);
    expect(result.matchedWork?.agentSessionRunCount).toBeGreaterThan(0);
    expect(result.matchedWork?.agentSessionRunWithTurnIdCount).toBeGreaterThan(0);
    expect(result.dockObservationError ?? undefined).toBeUndefined();
    expect(result.dockObserved).toBe(true);
    expect(result.cleanup.archiveStatus).toBe('archived');
  });
});
