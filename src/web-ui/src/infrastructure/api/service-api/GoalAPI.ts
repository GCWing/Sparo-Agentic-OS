import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

export type GoalStatus =
  | 'active'
  | 'judging'
  | 'waiting_user'
  | 'paused'
  | 'blocked'
  | 'budget_limited'
  | 'completed'
  | 'cancelled';

export interface GoalGap {
  criterionId: string;
  description: string;
}

export type GoalExtractionStatus =
  | 'queued'
  | 'running'
  | 'accepted'
  | 'needs_clarification'
  | 'rejected'
  | 'failed';

export type GoalJudgeStatus =
  | 'queued'
  | 'running'
  | 'decided'
  | 'rejected'
  | 'failed';

export type GoalVerdictState = 'pass' | 'continue' | 'needs_user' | 'blocked';

export type GoalJudgeTrigger = 'turn_completed' | 'user_review' | 'resume';

export interface GoalCriterion {
  id: string;
  description: string;
  required: boolean;
}

export interface GoalRequiredCheck {
  id: string;
  description: string;
  command?: string | null;
}

export interface GoalJudgmentSummary {
  judgeId: string;
  state: GoalVerdictState;
  summary: string;
  remainingGaps: GoalGap[];
  confidence: number;
  judgedAtMs: number;
}

export interface GoalRecord {
  goalId: string;
  sessionId: string;
  revision: number;
  status: GoalStatus;
  contract: {
    rawTrigger: string;
    resolvedObjective: string;
    successCriteria: GoalCriterion[];
    requiredChecks?: GoalRequiredCheck[];
    nonGoals?: string[];
    constraints?: string[];
    riskLevel?: 'low' | 'medium' | 'high';
  };
  context?: {
    frozenContextMarkdown?: string;
  };
  progress: {
    notes?: string[];
    remainingGaps: GoalGap[];
    continuationTurns: number;
    judgeRuns?: number;
    noProgressStreak?: number;
    lastMetCount?: number;
    lastSummary?: string | null;
    triggerTurnId?: string | null;
    lastTurnId?: string | null;
  };
  budgets?: {
    maxContinuationTurns: number;
    maxJudgeRuns?: number;
    maxNoProgressStreak?: number;
  };
  latestExtraction?: {
    extractionId: string;
    status: GoalExtractionStatus;
    confidence: number;
    intent: string;
    warnings: string[];
    updatedAtMs: number;
  } | null;
  latestJudgment?: GoalJudgmentSummary | null;
  pendingUserQuestion?: string | null;
  createdAtMs?: number;
  updatedAtMs: number;
}

export interface GoalExtractionRun {
  extractionId: string;
  parentSessionId?: string;
  extractionSessionId?: string | null;
  triggerTurnId?: string;
  rawInput?: string;
  status: GoalExtractionStatus;
  finalText?: string | null;
  rejectionReason?: string | null;
  createdAtMs?: number;
  updatedAtMs?: number;
}

export interface GoalVerdict {
  state: GoalVerdictState;
  summary?: string;
  criteria?: Array<{ id: string; met: boolean; note: string }>;
  remainingGaps?: string[];
  nextSteering?: string;
  userQuestion?: string | null;
  confidence?: number;
}

export interface GoalJudgeRun {
  judgeId: string;
  parentSessionId?: string;
  judgeSessionId?: string | null;
  goalId?: string;
  goalRevision?: number;
  turnId?: string;
  trigger?: GoalJudgeTrigger;
  status: GoalJudgeStatus;
  finalText?: string | null;
  verdict?: GoalVerdict | null;
  rejectionReason?: string | null;
  createdAtMs?: number;
  updatedAtMs?: number;
}

export interface GoalResponse {
  accepted: boolean;
  message: string;
  goal?: GoalRecord | null;
  extraction?: GoalExtractionRun | null;
  judge?: GoalJudgeRun | null;
}

export type GoalControlAction = 'status' | 'pause' | 'resume' | 'clear' | 'review';

export type GoalLifecycleEventType =
  | 'goal_extraction_run'
  | 'goal_judge_run'
  | 'goal_updated'
  | 'goal_cleared';

export interface GoalLifecycleEvent {
  eventType: GoalLifecycleEventType;
  sessionId: string;
  workspacePath: string;
  goal?: GoalRecord | null;
  extraction?: GoalExtractionRun | null;
  judge?: GoalJudgeRun | null;
  message?: string | null;
  updatedAtMs: number;
}

class GoalAPI {
  async submitSessionGoal(request: {
    sessionId: string;
    workspacePath: string;
    rawInput: string;
    agentType?: string;
    turnId?: string;
    skipInitialContinuation?: boolean;
  }): Promise<GoalResponse> {
    try {
      return await api.invoke<GoalResponse>('submit_session_goal', { request });
    } catch (error) {
      throw createTauriCommandError('submit_session_goal', error, request);
    }
  }

  async getSessionGoal(sessionId: string, workspacePath: string): Promise<GoalResponse> {
    try {
      return await api.invoke<GoalResponse>('get_session_goal', {
        request: { sessionId, workspacePath },
      });
    } catch (error) {
      throw createTauriCommandError('get_session_goal', error, { sessionId, workspacePath });
    }
  }

  async controlSessionGoal(request: {
    sessionId: string;
    workspacePath: string;
    action: GoalControlAction;
    expectedGoalId?: string;
    expectedRevision?: number;
  }): Promise<GoalResponse> {
    try {
      return await api.invoke<GoalResponse>('control_session_goal', { request });
    } catch (error) {
      throw createTauriCommandError('control_session_goal', error, request);
    }
  }

  onGoalEvent(callback: (event: GoalLifecycleEvent) => void): () => void {
    return api.listen<GoalLifecycleEvent>('agentic://goal-event', callback);
  }
}

export const goalAPI = new GoalAPI();
export default goalAPI;
