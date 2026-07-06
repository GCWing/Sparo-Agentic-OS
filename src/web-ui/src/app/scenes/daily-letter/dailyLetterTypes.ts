export type DailyLetterScope = 'workspace' | 'agentic_os';

export type DailyLetterRecordStatus =
  | 'ready'
  | 'insufficient_context'
  | 'needs_receipt'
  | 'sealed';

export type DailyLetterReceiptStatus = 'pending' | 'accepted' | 'edited' | 'dismissed';

export interface DailyLetterWorkspaceRef {
  id: string;
  name: string;
  path: string;
}

export interface DailyLetterPreview {
  title: string;
  oneLine: string;
  receiptCount: number;
  continuationCount: number;
  appIdeaCount: number;
}

export interface DailyLetterReceiptCandidate {
  id: string;
  text: string;
  reason?: string | null;
  sourceIds: string[];
  status: DailyLetterReceiptStatus;
  finalText?: string | null;
  memoryJournalPath?: string | null;
  decidedAtMs?: number | null;
}

export interface DailyLetterContinuationCard {
  id: string;
  text: string;
  reason?: string | null;
  sourceIds: string[];
  remindTomorrow: boolean;
}

export interface DailyLetterAppOpportunity {
  id: string;
  title: string;
  summary: string;
  sourceIds: string[];
}

export interface DailyLetterRecord {
  id: string;
  date: string;
  scope: DailyLetterScope;
  workspace?: DailyLetterWorkspaceRef | null;
  status: DailyLetterRecordStatus;
  preview: DailyLetterPreview;
  bodyMarkdown: string;
  receiptCandidates: DailyLetterReceiptCandidate[];
  continuationCards: DailyLetterContinuationCard[];
  appOpportunity?: DailyLetterAppOpportunity | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface DailyLetterListRequest {
  scope?: DailyLetterScope;
  workspacePath?: string | null;
  limit?: number | null;
}

export interface DailyLetterGetRequest {
  id?: string | null;
  date?: string | null;
  scope?: DailyLetterScope | null;
  workspacePath?: string | null;
}

export interface DailyLetterGenerateRequest {
  date?: string | null;
  scope?: DailyLetterScope | null;
  workspacePath?: string | null;
  force?: boolean;
}

export type DailyLetterReceiptAction = 'accept' | 'edit' | 'dismiss';

export interface DailyLetterReceiptDecision {
  candidateId: string;
  action: DailyLetterReceiptAction;
  finalText?: string | null;
}

export interface DailyLetterApplyReceiptsRequest {
  recordId: string;
  workspacePath?: string | null;
  decisions: DailyLetterReceiptDecision[];
}

export interface DailyLetterSealRequest {
  recordId: string;
  workspacePath?: string | null;
}

export interface DailyLetterUpdateContinuationRequest {
  recordId: string;
  workspacePath?: string | null;
  continuationId: string;
  remindTomorrow: boolean;
}

export interface DailyLetterRunSummary {
  started: boolean;
  trigger: DailyLetterTrigger;
  date?: string | null;
  record?: DailyLetterRecord | null;
  reason?: string | null;
}

export type DailyLetterTrigger = 'auto' | 'manual';

export type DailyLetterAttemptStatus =
  | 'running'
  | 'ok'
  | 'error'
  | 'cancelled'
  | 'skipped_no_sources';

export interface DailyLetterState {
  lastCompletedDate?: string | null;
  activeDate?: string | null;
  activeRecordId?: string | null;
  lastAttemptedDate?: string | null;
  lastAttemptStartedAtMs?: number | null;
  lastAttemptFinishedAtMs?: number | null;
  lastAttemptStatus?: DailyLetterAttemptStatus | null;
  lastAttemptTrigger?: DailyLetterTrigger | null;
  lastError?: string | null;
  nextAutoRunNotBeforeMs?: number | null;
}
