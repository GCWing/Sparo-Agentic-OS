import { api } from '@/infrastructure/api/service-api/ApiClient';
import { createTauriCommandError } from '@/infrastructure/api/errors/TauriCommandError';
import type {
  BackgroundProcess,
  BackgroundProcessKind,
  BackgroundProcessList,
  BackgroundProcessScope,
  RunBackgroundProcessRequest,
  RunBackgroundProcessResponse,
} from '../domain/backgroundProcessTypes';

type RawBackgroundProcessScope =
  | { kind: 'system' }
  | { kind: 'workspace'; workspace_path: string }
  | { kind: 'session'; session_id: string }
  | { kind: 'path'; path: string };

type RawBackgroundProcess = Omit<BackgroundProcess, 'scope'> & {
  scope: RawBackgroundProcessScope;
};

type RawBackgroundProcessList = {
  generatedAt: number;
  processes: RawBackgroundProcess[];
};

function fromRawScope(scope: RawBackgroundProcessScope): BackgroundProcessScope {
  switch (scope.kind) {
    case 'workspace':
      return { kind: 'workspace', workspacePath: scope.workspace_path };
    case 'session':
      return { kind: 'session', sessionId: scope.session_id };
    case 'path':
      return { kind: 'path', path: scope.path };
    case 'system':
      return { kind: 'system' };
  }
}

function fromRawProcess(process: RawBackgroundProcess): BackgroundProcess {
  return {
    ...process,
    scope: fromRawScope(process.scope),
    outputRefs: process.outputRefs ?? [],
    actions: process.actions ?? [],
  };
}

export class BackgroundProcessApi {
  async listProcesses(): Promise<BackgroundProcessList> {
    try {
      const response = await api.invoke<RawBackgroundProcessList>(
        'agentic_os_list_background_processes',
        {}
      );
      return {
        generatedAt: response.generatedAt,
        processes: response.processes.map(fromRawProcess),
      };
    } catch (error) {
      throw createTauriCommandError('agentic_os_list_background_processes', error, {});
    }
  }

  async runProcess(kind: BackgroundProcessKind): Promise<RunBackgroundProcessResponse> {
    const request: RunBackgroundProcessRequest = { kind };
    try {
      return await api.invoke<RunBackgroundProcessResponse>(
        'agentic_os_run_background_process',
        { request }
      );
    } catch (error) {
      throw createTauriCommandError('agentic_os_run_background_process', error, request);
    }
  }
}

export const backgroundProcessApi = new BackgroundProcessApi();
