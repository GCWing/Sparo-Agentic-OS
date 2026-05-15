import type { ChatInputPetMood } from '@/flow_chat/utils/chatInputPetMood';
import type { AgentCompanionTaskStatus } from '@/flow_chat/utils/agentCompanionActivity';

export type PetSpriteAction =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review';

export type PetSpriteSecondaryMotion =
  | 'breathe'
  | 'hover'
  | 'work'
  | 'drag'
  | 'jump'
  | 'sad';

export interface PetMotionSnapshot {
  direction: 'left' | 'right';
  speed: number;
}

export interface PetInteractionSnapshot {
  kind: 'none' | 'hover' | 'dragging' | 'settling';
  motion?: PetMotionSnapshot;
}

export interface PetBehaviorInput {
  mood: ChatInputPetMood;
  tasks: AgentCompanionTaskStatus[];
  interaction: PetInteractionSnapshot;
  now: number;
}

export interface PetBehaviorMemory {
  transientSignature: string | null;
  transientAction: PetSpriteAction | null;
  transientUntil: number;
}

export interface PetBehaviorResult {
  action: PetSpriteAction;
  motionSpeed: number;
  memory: PetBehaviorMemory;
  nextWakeDelayMs: number | null;
}

export interface PetRenderAction {
  action: PetSpriteAction;
  row: number;
  frames: number;
  durationMs: number;
  secondary: PetSpriteSecondaryMotion;
  frameEnd: string;
}

