import type { ShellInfo } from '@/shared/types/terminal';
import { createTauriCommandError } from '../errors/TauriCommandError';
import { api } from './ApiClient';

export class TerminalAPI {
  async listAvailableShells(): Promise<ShellInfo[]> {
    try {
      return await api.invoke<ShellInfo[]>('terminal_get_shells');
    } catch (error) {
      throw createTauriCommandError('terminal_get_shells', error);
    }
  }
}

export const terminalAPI = new TerminalAPI();
