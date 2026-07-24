import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import type {
  SessionLocator,
  SessionMetadata,
} from '@/shared/types/session-history';
import type { WorkLocator } from '@/shared/types/work-locator';

export interface OpenProductAppSessionRequest {
  workLocator: WorkLocator;
  appId: string;
  channelId: string;
  entityId?: string | null;
  sessionName: string;
  agentType: string;
  customMetadata?: Record<string, unknown>;
}

export interface ProductAppSessionHistoryBinding {
  executionWorkspacePath: string;
  locator: SessionLocator;
}

export interface OpenProductAppSessionResponse {
  sessionId: string;
  created: boolean;
  history: ProductAppSessionHistoryBinding;
  metadata: SessionMetadata;
}

export class ProductAppSessionAPI {
  async open(
    request: OpenProductAppSessionRequest,
  ): Promise<OpenProductAppSessionResponse> {
    try {
      return await api.invoke<OpenProductAppSessionResponse>(
        'open_product_app_session',
        { request },
      );
    } catch (error) {
      throw createTauriCommandError('open_product_app_session', error, {
        workLocator: request.workLocator,
        appId: request.appId,
        channelId: request.channelId,
        entityId: request.entityId,
      });
    }
  }
}

export const productAppSessionAPI = new ProductAppSessionAPI();
