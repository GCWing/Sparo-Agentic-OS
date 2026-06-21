import type { TFunction } from 'i18next';
import type { SessionComposerActionProviderId, SessionProfile } from '@/app/session-profiles';
import type { SessionDescriptor } from '@/flow_chat/domain/sessionDescriptor';
import type { SessionCustomMetadata, SessionStorageScope } from '@/shared/types/session-history';
import type { AgentInfo } from '../../../../reducers/agentReducer';
import type { ComposerMcpPromptCommand } from '../../model/composerCommands';
import type { ComposerActionDescriptor } from '../composerActionTypes';

export type BuiltInComposerActionProviderId =
  | 'built-in-context'
  | 'built-in-target'
  | 'session-agent-switch'
  | 'built-in-operation'
  | 'mcp-prompt';

export type ComposerActionProviderId =
  | BuiltInComposerActionProviderId
  | SessionComposerActionProviderId;

export interface ComposerActionProviderContext {
  t: TFunction<'flow-chat'>;
  profile: SessionProfile;
  descriptor?: SessionDescriptor | null;
  targetSessionId: string | null;
  workspacePath: string | null;
  storageScope?: SessionStorageScope;
  customMetadata?: SessionCustomMetadata;
  availableAgents: AgentInfo[];
  currentAgent: string;
  isComposerActive: boolean;
  hasCurrentSession: boolean;
  hasTargetSession: boolean;
  isBtwSession: boolean;
  isProcessing: boolean;
  supportsGoal: boolean;
  mcpPromptCommands: ComposerMcpPromptCommand[];
}

export interface ComposerActionProvider {
  id: ComposerActionProviderId;
  resolve(context: ComposerActionProviderContext): ComposerActionDescriptor[];
}
