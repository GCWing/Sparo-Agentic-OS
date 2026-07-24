import type { SessionDescriptor } from '@/flow_chat/domain/sessionDescriptor';
import type { WorkspaceInfo } from '@/shared/types';

type StartupWorkspace = Pick<WorkspaceInfo, 'id' | 'name' | 'rootPath'>;

interface WorkspaceInitializationResult {
  createdSessionId?: string;
  focusedSessionId: string | null;
}

interface StartupFlowChatManager {
  initializeSessionRuntime(): Promise<void>;
  initializeWorkspaceSessionState(
    workspace: StartupWorkspace,
    options: {
      preferredDescriptor?: SessionDescriptor;
      skipAutoSelectSession: true;
      createDefaultSession: false;
    },
  ): Promise<WorkspaceInitializationResult>;
}

interface InitializeFlowChatStartupOptions {
  manager: StartupFlowChatManager;
  workspace?: StartupWorkspace | null;
  preferredDescriptor?: SessionDescriptor;
  openDefaultAgenticOs: boolean;
  commitStartupHome: () => void;
  openAgenticOsSession: () => Promise<string | null>;
}

export interface FlowChatStartupResult {
  agenticOsSessionId: string | null;
  workspaceInitialization: WorkspaceInitializationResult | null;
}

export function shouldOpenDefaultAgenticOsAtStartup(options: {
  alreadyApplied: boolean;
  preferredMode?: string;
  hasWorkspace: boolean;
}): boolean {
  return (
    !options.alreadyApplied &&
    (!options.preferredMode || !options.hasWorkspace)
  );
}

/**
 * Owns startup ordering across the system and optional project session domains.
 * The shared runtime and default Agentic OS session do not require a workspace.
 */
export async function initializeFlowChatStartup({
  manager,
  workspace,
  preferredDescriptor,
  openDefaultAgenticOs,
  commitStartupHome,
  openAgenticOsSession,
}: InitializeFlowChatStartupOptions): Promise<FlowChatStartupResult> {
  if (openDefaultAgenticOs) {
    commitStartupHome();
  }

  await manager.initializeSessionRuntime();

  const agenticOsSessionId = openDefaultAgenticOs
    ? await openAgenticOsSession()
    : null;

  const workspaceInitialization = workspace
    ? await manager.initializeWorkspaceSessionState(
        workspace,
        {
          preferredDescriptor,
          skipAutoSelectSession: true,
          createDefaultSession: false,
        },
      )
    : null;

  return {
    agenticOsSessionId,
    workspaceInitialization,
  };
}
