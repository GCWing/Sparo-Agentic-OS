import type {
  ConfigScope,
  ConfigStoredValue,
  JsonValue,
  SettingApplyStrategy,
  SettingRisk,
} from '../catalog/types';

export type ConfigChangeSourceKind =
  | 'manual'
  | 'ai'
  | 'cli'
  | 'import'
  | 'system';

export interface ConfigChangeSource {
  kind: ConfigChangeSourceKind;
  surface?: string;
  requestId?: string;
}

export type ConfigPatchOperation =
  | { op: 'set'; settingId: string; value: JsonValue }
  | { op: 'reset'; settingId: string };

export interface PlanConfigPatchRequest {
  requestId: string;
  idempotencyKey: string;
  expectedRevision: number;
  scope: ConfigScope;
  operations: readonly ConfigPatchOperation[];
}

export interface ConfigPlanChange {
  settingId: string;
  before: ConfigStoredValue;
  after: ConfigStoredValue;
  risk: SettingRisk;
  applyStrategy: SettingApplyStrategy;
}

export interface SettingsSectionRef {
  categoryId: string;
  tabId: string;
  sectionId: string;
  fieldIds: readonly string[];
}

export interface ConfigPlanWarning {
  code: string;
  settingId?: string;
}

export interface ConfigPlan {
  planId: string;
  baseRevision: number;
  catalogVersion: string;
  operationHash: string;
  expiresAtMs: number;
  changes: readonly ConfigPlanChange[];
  requiresConfirmation: boolean;
  affectedSections: readonly SettingsSectionRef[];
  warnings: readonly ConfigPlanWarning[];
}

export interface CommitConfigPatchRequest {
  planId: string;
  expectedRevision: number;
  idempotencyKey: string;
  confirmed: boolean;
}

export interface UndoConfigCommitRequest {
  commitId: string;
  undoToken: string;
  expectedRevision: number;
  idempotencyKey: string;
  confirmed: boolean;
}

export interface RetryConfigApplyRequest {
  commitId: string;
  expectedRevision: number;
  consumer: string;
  expectedAttempt: number;
  idempotencyKey: string;
}

export type ConfigApplyReceiptStatus =
  | 'pending'
  | 'applied'
  | 'restartRequired'
  | 'failed'
  | 'superseded'
  | 'rolledBack';

export interface ConfigApplyReceipt {
  consumer: string;
  settingIds: readonly string[];
  attempt: number;
  attemptedAt: string;
  status: ConfigApplyReceiptStatus;
  critical: boolean;
}

export interface ConfigValueChange {
  settingId: string;
  oldValue: ConfigStoredValue;
  newValue: ConfigStoredValue;
  applyStrategy: SettingApplyStrategy;
}

export type ConfigCommitStatus =
  | 'applying'
  | 'applied'
  | 'partial'
  | 'rolledBack';

export interface ConfigCommit {
  commitId: string;
  revision: number;
  status: ConfigCommitStatus;
  scope: ConfigScope;
  source: ConfigChangeSource;
  changes: readonly ConfigValueChange[];
  applyReceipts: readonly ConfigApplyReceipt[];
  affectedSections: readonly SettingsSectionRef[];
  restartRequired: readonly string[];
  undoToken: string | null;
  committedAt: string;
}

export interface ConfigCommittedEvent {
  commitId: string;
  revision: number;
  catalogVersion: string;
  scope: ConfigScope;
  source: ConfigChangeSource;
  changes: readonly ConfigValueChange[];
  affectedSections: readonly SettingsSectionRef[];
  committedAt: string;
}

export interface ConfigRolledBackEvent {
  originalCommitId: string;
  rollbackCommit: ConfigCommittedEvent;
}

export type ConfigApplyStatus =
  | 'applied'
  | 'restartRequired'
  | 'partial'
  | 'failed'
  | 'superseded'
  | 'rolledBack';

export interface ConfigApplyStatusEvent {
  commitId: string;
  revision: number;
  consumer: string;
  receiptAttempt: number;
  status: ConfigApplyStatus;
}
