import { api } from '@/infrastructure/api/service-api/ApiClient';
import { createTauriCommandError } from '@/infrastructure/api/errors/TauriCommandError';
import type {
  DailyLetterApplyReceiptsRequest,
  DailyLetterGenerateRequest,
  DailyLetterGetRequest,
  DailyLetterListRequest,
  DailyLetterRecord,
  DailyLetterRunSummary,
  DailyLetterSealRequest,
  DailyLetterState,
} from './dailyLetterTypes';

export class DailyLetterApi {
  async list(request: DailyLetterListRequest = {}): Promise<DailyLetterRecord[]> {
    try {
      return await api.invoke<DailyLetterRecord[]>('daily_letter_list', { request });
    } catch (error) {
      throw createTauriCommandError('daily_letter_list', error, request);
    }
  }

  async get(request: DailyLetterGetRequest): Promise<DailyLetterRecord | null> {
    try {
      return await api.invoke<DailyLetterRecord | null>('daily_letter_get', { request });
    } catch (error) {
      throw createTauriCommandError('daily_letter_get', error, request);
    }
  }

  async generate(request: DailyLetterGenerateRequest = {}): Promise<DailyLetterRunSummary> {
    try {
      return await api.invoke<DailyLetterRunSummary>('daily_letter_generate', { request });
    } catch (error) {
      throw createTauriCommandError('daily_letter_generate', error, request);
    }
  }

  async applyReceipts(request: DailyLetterApplyReceiptsRequest): Promise<DailyLetterRecord> {
    try {
      return await api.invoke<DailyLetterRecord>('daily_letter_apply_receipts', { request });
    } catch (error) {
      throw createTauriCommandError('daily_letter_apply_receipts', error, request);
    }
  }

  async seal(request: DailyLetterSealRequest): Promise<DailyLetterRecord> {
    try {
      return await api.invoke<DailyLetterRecord>('daily_letter_seal', { request });
    } catch (error) {
      throw createTauriCommandError('daily_letter_seal', error, request);
    }
  }

  async state(): Promise<DailyLetterState> {
    try {
      return await api.invoke<DailyLetterState>('daily_letter_state');
    } catch (error) {
      throw createTauriCommandError('daily_letter_state', error, undefined);
    }
  }
}

export const dailyLetterApi = new DailyLetterApi();
