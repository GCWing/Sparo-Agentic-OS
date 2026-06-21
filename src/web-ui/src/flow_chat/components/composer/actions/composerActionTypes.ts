import type { ComposerMcpPromptCommand } from '../model/composerCommands';
import type {
  ComposerModifierIntent,
  ComposerOperationIntent,
  ComposerTargetIntent,
} from '../model/composerIntentState';

export type ComposerActionAvailabilityState = 'enabled' | 'disabled' | 'hidden';

export interface ComposerActionAvailability {
  state: ComposerActionAvailabilityState;
  reason?: string;
}

export type ComposerActionMenuSectionId =
  | 'agent'
  | 'context'
  | 'intent'
  | 'app';

export type ComposerActionCommandGroup =
  | 'target'
  | 'send-with'
  | 'session-action'
  | 'app'
  | 'template';

export type ComposerActionKind =
  | 'attach-context'
  | 'attach-image'
  | 'skills'
  | 'target'
  | 'modifier'
  | 'operation'
  | 'agent-switch'
  | 'prompt-template'
  | 'app-action';

export type ComposerActionIconId =
  | 'agent'
  | 'context'
  | 'image'
  | 'skills'
  | 'btw'
  | 'goal'
  | 'compact'
  | 'init'
  | 'prompt'
  | 'app';

export type ComposerActionSelect =
  | { type: 'open-context-picker' }
  | { type: 'pick-image' }
  | { type: 'open-skills-flyout' }
  | { type: 'set-target'; target: ComposerTargetIntent }
  | { type: 'add-modifier'; modifier: ComposerModifierIntent }
  | { type: 'set-operation'; operation: ComposerOperationIntent }
  | { type: 'switch-agent'; agentId: string }
  | { type: 'set-prompt-template'; prompt: ComposerMcpPromptCommand }
  | { type: 'dispatch-app-action'; providerId: string; actionId: string; payload?: unknown };

export interface ComposerActionMenuPresentation {
  section: ComposerActionMenuSectionId;
  control: 'row' | 'submenu';
  order: number;
  testId?: string;
}

export interface ComposerActionDescriptor {
  id: string;
  providerId?: string;
  label: string;
  description: string;
  kind: ComposerActionKind;
  icon: ComposerActionIconId;
  select: ComposerActionSelect;
  availability: ComposerActionAvailability;
  current?: boolean;
  order: number;
  menu?: ComposerActionMenuPresentation;
  command?: `/${string}`;
  commandGroup?: ComposerActionCommandGroup;
  commandGroupLabel?: string;
}

export interface ComposerActionSection {
  id: ComposerActionMenuSectionId;
  actions: ComposerActionDescriptor[];
}
