/**
 * L0 Bridge App spec: verifies the desktop WebView can reach Bridge App commands
 * through the real Tauri IPC layer.
 */

import { browser, expect } from '@wdio/globals';

type TauriBridgeSmokeResult = {
  manifest: {
    id: string;
    schemaVersion: number;
    capabilityIds: string[];
    shellPermissions: string[];
  };
  run: {
    runId: string;
    status: string;
    capabilityId?: string;
    dryRun?: boolean;
    outputMode?: string;
  };
  storedRun: {
    runId: string;
    status: string;
    eventCount: number;
  };
};

type AgentBridgeServiceResult = {
  bridgeApp: {
    id: string;
    allIds: string[];
    toolNames: string[];
  };
  agentApp: {
    cursorAgentExists: boolean;
    cursorSdkExists: boolean;
    cursorSdkTools: string[];
  };
  session: {
    agentType?: string;
    sessionId?: string;
  };
  toolInfo: {
    name?: string;
    cardKind?: string;
    cardTitle?: string;
    family?: string;
  };
  toolRun: {
    success: boolean;
    status?: string;
    bridgeId?: string;
    capabilityId?: string;
    dryRun?: boolean;
  };
  healthRun: {
    success: boolean;
    status?: string;
    bridgeId?: string;
    capabilityId?: string;
    hasApiKey?: boolean;
    ready?: boolean;
  };
  failedRun: {
    success: boolean;
    error?: string;
  };
};

describe('L0 Bridge App Tests', () => {
  it('runs the Cursor SDK Bridge capability through Tauri IPC', async () => {
    const result = await browser.executeAsync<TauriBridgeSmokeResult>((done) => {
      (async () => {
        const tauriInternals = (window as any).__TAURI_INTERNALS__;
        const invoke = tauriInternals?.invoke;

        if (typeof invoke !== 'function') {
          throw new Error('Tauri IPC invoke is not available');
        }

        const bridgeApps = await invoke<any[]>('list_bridge_apps', {});
        const cursorBridge = bridgeApps.find(app => app?.manifest?.id === 'cursor-sdk');

        if (!cursorBridge) {
          throw new Error('cursor-sdk Bridge App was not found');
        }

        const capability = cursorBridge.manifest.capabilities?.find(
          (item: any) => item.id === 'cursor.agent',
        );

        if (!capability) {
          throw new Error('cursor.agent Bridge capability was not found');
        }

        const run = await invoke<any>('run_bridge_app_action', {
          request: {
            appId: 'cursor-sdk',
            capabilityId: 'cursor.agent',
            action: 'start',
            input: {
              prompt: 'E2E dry run for Cursor SDK Bridge capability',
              mode: 'local',
              dryRun: true,
            },
          },
        });

        const storedRun = await invoke<any>('get_bridge_app_run', {
          request: { runId: run.runId },
        });

        done({
          manifest: {
            id: cursorBridge.manifest.id,
            schemaVersion: cursorBridge.manifest.schemaVersion,
            capabilityIds: cursorBridge.manifest.capabilities?.map((item: any) => item.id) ?? [],
            shellPermissions: cursorBridge.manifest.permissions?.shell ?? [],
          },
          run: {
            runId: run.runId,
            status: run.status,
            capabilityId: run.capabilityId,
            dryRun: Boolean(run.output?.dryRun),
            outputMode: run.output?.mode,
          },
          storedRun: {
            runId: storedRun.runId,
            status: storedRun.status,
            eventCount: storedRun.events?.length ?? 0,
          },
        });
      })().catch(error => {
        done({
          error: error instanceof Error ? error.message : String(error),
        } as any);
      });
    });

    expect((result as any).error).toBeUndefined();
    expect(result.manifest.id).toBe('cursor-sdk');
    expect(result.manifest.schemaVersion).toBe(1);
    expect(result.manifest.capabilityIds).toContain('cursor.agent');
    expect(result.manifest.shellPermissions).toContain('node');
    expect(result.run.status).toBe('completed');
    expect(result.run.capabilityId).toBe('cursor.agent');
    expect(result.run.dryRun).toBe(true);
    expect(result.run.outputMode).toBe('local');
    expect(result.storedRun.runId).toBe(result.run.runId);
    expect(result.storedRun.status).toBe('completed');
    expect(result.storedRun.eventCount).toBeGreaterThan(0);
  });

  it('registers the Cursor Agent tool from the Bridge App bundle metadata', async () => {
    const workspacePath = process.cwd();
    const result = await browser.executeAsync<AgentBridgeServiceResult>((workspacePath, done) => {
      (async () => {
        const tauriInternals = (window as any).__TAURI_INTERNALS__;
        const invoke = tauriInternals?.invoke;

        if (typeof invoke !== 'function') {
          throw new Error('Tauri IPC invoke is not available');
        }

        const bridgeApps = await invoke<any[]>('list_bridge_apps', {});
        const cursorBridge = bridgeApps.find(app => app?.manifest?.id === 'cursor-sdk');
        const agentApps = await invoke<any[]>('list_agent_apps', { request: {} });
        const cursorAgent = agentApps.find(app => app?.id === 'cursor-agent');
        const cursorSdkAgent = agentApps.find(app => app?.id === 'cursor-sdk');
        const tools = await invoke<any[]>('get_all_tools_info', {});
        const cursorAgentTool = tools.find((tool: any) => tool?.name === 'bridgeapp__cursor-sdk__CursorAgent');

        if (!cursorBridge) {
          throw new Error('cursor-sdk Bridge App was not found');
        }
        if (!cursorSdkAgent) {
          throw new Error('cursor-sdk Bridge App was not projected as an Agent App entry');
        }
        if (!cursorAgentTool?.ui?.card) {
          throw new Error('cursor-sdk Bridge App tool UI card metadata was not found');
        }

        const session = await invoke<any>('create_session', {
          request: {
            sessionName: `Cursor Bridge Agent E2E ${Date.now()}`,
            agentType: 'cursor-sdk',
            workspacePath,
            storageScope: 'workspace',
            config: null,
            sessionId: null,
          },
        });

        const toolRun = await invoke<any>('execute_tool', {
          request: {
            toolName: 'bridgeapp__cursor-sdk__CursorAgent',
            input: {
              prompt: 'E2E dry run through Bridge App tool extension',
              mode: 'local',
              dryRun: true,
            },
            workspacePath: null,
            context: null,
            safeMode: null,
          },
        });

        const healthRun = await invoke<any>('execute_tool', {
          request: {
            toolName: 'bridgeapp__cursor-sdk__CursorAgent',
            input: {
              action: 'health',
              validateApiKey: false,
              autoInstallDependencies: false,
            },
            workspacePath: null,
            context: null,
            safeMode: null,
          },
        });

        const failedRun = await invoke<any>('execute_tool', {
          request: {
            toolName: 'bridgeapp__cursor-sdk__CursorAgent',
            input: {
              action: 'start',
            },
            workspacePath: null,
            context: null,
            safeMode: null,
          },
        });

        done({
          bridgeApp: {
            id: cursorBridge.manifest.id,
            allIds: bridgeApps.map(app => app?.manifest?.id).filter(Boolean),
            toolNames: cursorBridge.manifest.tools?.map((tool: any) => tool.name) ?? [],
          },
          agentApp: {
            cursorAgentExists: Boolean(cursorAgent),
            cursorSdkExists: Boolean(cursorSdkAgent),
            cursorSdkTools: cursorSdkAgent.tools ?? [],
          },
          session: {
            agentType: session.agentType,
            sessionId: session.sessionId,
          },
          toolInfo: {
            name: cursorAgentTool.name,
            cardKind: cursorAgentTool.ui.card.kind,
            cardTitle: cursorAgentTool.ui.card.title,
            family: cursorAgentTool.ui.card.family,
          },
          toolRun: {
            success: Boolean(toolRun.success),
            status: toolRun.result?.status,
            bridgeId: toolRun.result?.bridge_id,
            capabilityId: toolRun.result?.capability_id,
            dryRun: Boolean(toolRun.result?.output?.dryRun),
          },
          healthRun: {
            success: Boolean(healthRun.success),
            status: healthRun.result?.status,
            bridgeId: healthRun.result?.bridge_id,
            capabilityId: healthRun.result?.capability_id,
            hasApiKey: Boolean(healthRun.result?.output?.hasApiKey),
            ready: Boolean(healthRun.result?.output?.ready),
          },
          failedRun: {
            success: Boolean(failedRun.success),
            error: failedRun.error,
          },
        });
      })().catch(error => {
        done({
          error: error instanceof Error ? error.message : String(error),
        } as any);
      });
    }, workspacePath);

    expect((result as any).error).toBeUndefined();
    expect(result.bridgeApp.id).toBe('cursor-sdk');
    expect(result.bridgeApp.allIds).not.toContain('cursor-bridge');
    expect(result.bridgeApp.toolNames).toEqual(['CursorAgent']);
    expect(result.agentApp.cursorAgentExists).toBe(false);
    expect(result.agentApp.cursorSdkExists).toBe(true);
    expect(result.agentApp.cursorSdkTools).toEqual(['bridgeapp__cursor-sdk__CursorAgent']);
    expect(result.session.agentType).toBe('cursor-sdk');
    expect(result.session.sessionId).toBeTruthy();
    expect(result.toolInfo.name).toBe('bridgeapp__cursor-sdk__CursorAgent');
    expect(result.toolInfo.cardKind).toBe('appDefined');
    expect(result.toolInfo.cardTitle).toBe('Cursor Agent');
    expect(result.toolInfo.family).toBe('bridge-app');
    expect(result.toolRun.success).toBe(true);
    expect(result.toolRun.status).toBe('completed');
    expect(result.toolRun.bridgeId).toBe('cursor-sdk');
    expect(result.toolRun.capabilityId).toBe('cursor.agent');
    expect(result.toolRun.dryRun).toBe(true);
    expect(result.healthRun.success).toBe(true);
    expect(result.healthRun.status).toBe('completed');
    expect(result.healthRun.bridgeId).toBe('cursor-sdk');
    expect(result.healthRun.capabilityId).toBe('cursor.agent');
    expect(typeof result.healthRun.hasApiKey).toBe('boolean');
    expect(typeof result.healthRun.ready).toBe('boolean');
    expect(result.failedRun.success).toBe(false);
    expect(result.failedRun.error).toContain('prompt is required');
  });
});
