import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export type AppCatalogKind = 'liveApp' | 'agentApp' | 'bridgeApp';

export interface AppCatalogEntry {
  id: string;
  name: string;
  description: string;
  kind: AppCatalogKind;
  icon: string;
  category: string;
  enabled: boolean;
}

export class AppCatalogAPI {
  async listAppCatalog(): Promise<AppCatalogEntry[]> {
    try {
      return await api.invoke('list_app_catalog', {});
    } catch (error) {
      throw createTauriCommandError('list_app_catalog', error);
    }
  }
}

export const appCatalogAPI = new AppCatalogAPI();
