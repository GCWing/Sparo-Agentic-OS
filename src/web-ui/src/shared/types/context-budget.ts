export type ContextSegmentKind =
  | 'system_prompt'
  | 'environment'
  | 'workspace_instructions'
  | 'memory'
  | 'files_context'
  | 'tool_schemas'
  | 'skill_catalog'
  | 'subagent_catalog'
  | 'conversation_history'
  | 'current_user_message'
  | 'assistant_history'
  | 'tool_results'
  | 'images'
  | 'compression_summary'
  | 'provider_overhead';

export interface ContextBudgetSegment {
  id: string;
  kind: ContextSegmentKind;
  label: string;
  tokens: number;
  percent: number;
  source?: {
    type?: string;
    id?: string;
    name?: string;
  };
  properties?: {
    staticPart?: boolean;
    cacheable?: boolean;
    compressible?: boolean;
    userVisible?: boolean;
  };
  children?: ContextBudgetSegment[];
}

export interface ContextBudgetSnapshot {
  id: string;
  kind: 'static' | 'request';
  sessionId: string;
  turnId?: string;
  roundId?: string;
  agentType: string;
  modelId: string;
  provider: string;
  contextWindow: number;
  totals: {
    inputTokens: number;
    reservedOutputTokens: number;
    remainingTokens: number;
    usedRatio: number;
  };
  estimation: {
    algorithm: string;
    confidence: 'high' | 'approx';
    calibrated: boolean;
    calibrationProfileId?: string;
  };
  segments: ContextBudgetSegment[];
  createdAt: number;
}
