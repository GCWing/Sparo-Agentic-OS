export type BackgroundProcessKind =
  | 'auto_memory_extraction'
  | 'memory_consolidation'
  | 'host_scan'
  | 'workspace_overview_refresh'
  | 'global_daily_report'
  | 'daily_letter'
  | 'global_milestone';

export type BackgroundProcessCategory = 'memory' | 'workspace' | 'report' | 'system';

export type BackgroundProcessStatus =
  | 'idle'
  | 'disabled'
  | 'scheduled'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'cooling_down';

export type BackgroundProcessTrigger =
  | 'auto'
  | 'manual'
  | 'startup_catch_up'
  | 'post_turn'
  | 'retry'
  | 'scheduled'
  | 'system';

export type BackgroundProcessPhase =
  | 'idle'
  | 'waiting_schedule'
  | 'waiting_retry'
  | 'queued'
  | 'running_hidden_agent'
  | 'scanning_host'
  | 'refreshing_workspace_overview'
  | 'consolidating_memory'
  | 'extracting_memory'
  | 'generating_report'
  | 'writing_daily_letter';

export type BackgroundProcessAction = 'run_now' | 'retry' | 'open_output' | 'open_settings';

export type BackgroundProcessScope =
  | { kind: 'system' }
  | { kind: 'workspace'; workspacePath: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'path'; path: string };

export interface BackgroundProcessOutputRef {
  label: string;
  path?: string | null;
  uri?: string | null;
}

export interface BackgroundProcessLastResult {
  status: BackgroundProcessStatus;
  finishedAt?: number | null;
  message?: string | null;
}

export interface BackgroundProcess {
  id: string;
  kind: BackgroundProcessKind;
  category: BackgroundProcessCategory;
  title: string;
  status: BackgroundProcessStatus;
  scope: BackgroundProcessScope;
  trigger?: BackgroundProcessTrigger | null;
  phase?: BackgroundProcessPhase | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  nextRunAt?: number | null;
  activeTurnId?: string | null;
  activeSessionId?: string | null;
  lastError?: string | null;
  lastResult?: BackgroundProcessLastResult | null;
  outputRefs: BackgroundProcessOutputRef[];
  actions: BackgroundProcessAction[];
}

export interface BackgroundProcessList {
  generatedAt: number;
  processes: BackgroundProcess[];
}

export interface RunBackgroundProcessRequest {
  kind: BackgroundProcessKind;
}

export interface RunBackgroundProcessResponse {
  kind: BackgroundProcessKind;
  started: boolean;
  turnId?: string | null;
  reason?: string | null;
}
