import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export type TokenUsageTimeRange = 'today' | 'thisWeek' | 'thisMonth' | 'all';

export interface GetTokenUsageRequest {
  timeRange?: TokenUsageTimeRange;
  modelId?: string;
  sessionId?: string;
  includeSubagent?: boolean;
  limit?: number;
  offset?: number;
}

export interface TokenUsageRecord {
  modelId: string;
  sessionId: string;
  turnId: string;
  agentType?: string | null;
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  isSubagent: boolean;
}

export interface ModelTokenStats {
  modelId: string;
  totalInput: number;
  totalOutput: number;
  totalCached: number;
  totalTokens: number;
  sessionCount: number;
  requestCount: number;
  firstUsed?: string | null;
  lastUsed?: string | null;
}

export interface SessionTokenStats {
  sessionId: string;
  modelId: string;
  agentType?: string | null;
  totalInput: number;
  totalOutput: number;
  totalCached: number;
  totalTokens: number;
  requestCount: number;
  createdAt: string;
  lastUpdated: string;
}

export interface TokenUsageSummary {
  totalInput: number;
  totalOutput: number;
  totalCached: number;
  totalTokens: number;
  byModel: Record<string, ModelTokenStats>;
  byAgent: Record<string, SessionTokenStats>;
  bySession: Record<string, SessionTokenStats>;
  recordCount: number;
}

export interface GetTokenUsageResponse {
  summary: TokenUsageSummary;
  records: TokenUsageRecord[];
}

export class TokenUsageAPI {
  async getTokenUsage(request: GetTokenUsageRequest): Promise<GetTokenUsageResponse> {
    try {
      return await api.invoke<GetTokenUsageResponse>('get_token_usage', { request });
    } catch (error) {
      throw createTauriCommandError('get_token_usage', error, request);
    }
  }

  async clearTokenUsage(): Promise<void> {
    try {
      await api.invoke<void>('clear_token_usage');
    } catch (error) {
      throw createTauriCommandError('clear_token_usage', error);
    }
  }
}

export const tokenUsageAPI = new TokenUsageAPI();
