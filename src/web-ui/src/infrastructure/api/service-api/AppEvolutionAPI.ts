import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export type EvolutionAutonomyLevel = 'off' | 'suggest' | 'assisted' | 'limitedAutonomy';
export type EvolutionProposalKind = 'create' | 'improve' | 'rebase';
export type EvolutionRiskLevel = 'low' | 'medium' | 'high';
export type EvolutionProposalStatus =
  | 'proposed'
  | 'drafting'
  | 'validating'
  | 'awaitingApproval'
  | 'shadowing'
  | 'canary'
  | 'active'
  | 'rejected'
  | 'failed'
  | 'rolledBack'
  | 'archived';

export interface EvolutionConsent {
  enabled: boolean;
  autonomyLevel: EvolutionAutonomyLevel;
  signalRetentionDays: number;
  allowContentAnalysis: boolean;
  allowProductInsights: boolean;
  updatedAtMs: number;
}

export interface EvolutionSignal {
  signalId: string;
  kind: string;
  slotId?: string | null;
  appId?: string | null;
  releaseId?: string | null;
  metrics?: Record<string, number>;
  occurredAtMs: number;
  expiresAtMs: number;
}

export interface EvolutionEvaluation {
  passed: boolean;
  nonInferior: boolean;
  rollbackVerified: boolean;
  isolatedDataVerified: boolean;
  checks?: string[];
}

export interface EvolutionProposal {
  proposalId: string;
  kind: EvolutionProposalKind;
  status: EvolutionProposalStatus;
  objective: string;
  evidenceSignalIds?: string[];
  baseAppId?: string | null;
  baseReleaseId?: string | null;
  candidateDraftId?: string | null;
  candidateReleaseId?: string | null;
  capabilityDelta?: string[];
  riskLevel: EvolutionRiskLevel;
  evaluation: EvolutionEvaluation;
  statusDetail?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface AppEvolutionState {
  schemaVersion: number;
  consent: EvolutionConsent;
  signals: Record<string, EvolutionSignal>;
  proposals: Record<string, EvolutionProposal>;
}

export interface SetEvolutionConsentInput {
  enabled: boolean;
  autonomyLevel: EvolutionAutonomyLevel;
  signalRetentionDays?: number;
  allowContentAnalysis?: boolean;
  allowProductInsights?: boolean;
}

export class AppEvolutionAPI {
  async getState(): Promise<AppEvolutionState> {
    try {
      return await api.invoke<AppEvolutionState>('get_app_evolution_state');
    } catch (error) {
      throw createTauriCommandError('get_app_evolution_state', error);
    }
  }

  async setConsent(input: SetEvolutionConsentInput): Promise<AppEvolutionState> {
    const request = {
      enabled: input.enabled,
      autonomyLevel: input.enabled ? input.autonomyLevel : 'off',
      signalRetentionDays: input.signalRetentionDays ?? 30,
      allowContentAnalysis: input.allowContentAnalysis ?? false,
      allowProductInsights: input.allowProductInsights ?? false,
    };
    try {
      return await api.invoke<AppEvolutionState>('set_app_evolution_consent', { request });
    } catch (error) {
      throw createTauriCommandError('set_app_evolution_consent', error, request);
    }
  }

  async approveProposalDraft(
    proposalId: string,
    candidateDraftId: string,
  ): Promise<EvolutionProposal> {
    const request = { proposalId, candidateDraftId };
    try {
      return await api.invoke<EvolutionProposal>('approve_app_evolution_proposal', { request });
    } catch (error) {
      throw createTauriCommandError('approve_app_evolution_proposal', error, request);
    }
  }

  async rejectProposal(proposalId: string): Promise<EvolutionProposal> {
    const request = { proposalId };
    try {
      return await api.invoke<EvolutionProposal>('reject_app_evolution_proposal', { request });
    } catch (error) {
      throw createTauriCommandError('reject_app_evolution_proposal', error, request);
    }
  }

  async rollbackProposal(proposalId: string): Promise<EvolutionProposal> {
    const request = { proposalId };
    try {
      return await api.invoke<EvolutionProposal>('rollback_app_evolution_proposal', { request });
    } catch (error) {
      throw createTauriCommandError('rollback_app_evolution_proposal', error, request);
    }
  }
}

export const appEvolutionAPI = new AppEvolutionAPI();
