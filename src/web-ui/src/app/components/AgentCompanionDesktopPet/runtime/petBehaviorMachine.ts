import type {
  PetBehaviorInput,
  PetBehaviorMemory,
  PetBehaviorResult,
  PetMotionSnapshot,
  PetSpriteAction,
} from './petTypes';
import { PET_FAST_DRAG_SPEED_PX_PER_SECOND } from './petMotionTracker';

const COMPLETED_TRANSIENT_MS = 1600;
const FAILED_TRANSIENT_MS = 1500;

export const EMPTY_PET_BEHAVIOR_MEMORY: PetBehaviorMemory = {
  transientSignature: null,
  transientAction: null,
  transientUntil: 0,
};

function taskSignature(input: PetBehaviorInput, states: Set<string>): string | null {
  const task = input.tasks
    .filter(candidate => states.has(candidate.state))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  return task ? `${task.sessionId}:${task.state}:${task.updatedAt}` : null;
}

function baseTaskAction(input: PetBehaviorInput): PetSpriteAction {
  if (input.tasks.some(task => task.state === 'attention')) {
    return 'waiting';
  }
  if (input.mood === 'waiting') {
    return 'waiting';
  }
  if (input.mood === 'analyzing') {
    return 'review';
  }
  if (input.mood === 'working') {
    return 'running';
  }
  return 'idle';
}

function actionForMotion(motion: PetMotionSnapshot): PetSpriteAction {
  return motion.direction === 'left' ? 'running-left' : 'running-right';
}

function settleAction(motion: PetMotionSnapshot): PetSpriteAction {
  if (motion.speed >= PET_FAST_DRAG_SPEED_PX_PER_SECOND) {
    return 'jumping';
  }
  return actionForMotion(motion);
}

export function resolvePetBehavior(
  input: PetBehaviorInput,
  previousMemory: PetBehaviorMemory = EMPTY_PET_BEHAVIOR_MEMORY,
): PetBehaviorResult {
  if (input.interaction.kind === 'dragging' && input.interaction.motion) {
    return {
      action: actionForMotion(input.interaction.motion),
      motionSpeed: input.interaction.motion.speed,
      memory: previousMemory,
      nextWakeDelayMs: null,
    };
  }

  if (input.interaction.kind === 'settling' && input.interaction.motion) {
    return {
      action: settleAction(input.interaction.motion),
      motionSpeed: input.interaction.motion.speed,
      memory: previousMemory,
      nextWakeDelayMs: null,
    };
  }

  const errorSignature = taskSignature(input, new Set(['error', 'interrupted']));
  if (errorSignature && errorSignature !== previousMemory.transientSignature) {
    const memory = {
      transientSignature: errorSignature,
      transientAction: 'failed' as PetSpriteAction,
      transientUntil: input.now + FAILED_TRANSIENT_MS,
    };
    return {
      action: 'failed',
      motionSpeed: 0,
      memory,
      nextWakeDelayMs: FAILED_TRANSIENT_MS,
    };
  }

  const completedSignature = taskSignature(input, new Set(['completed']));
  if (completedSignature && completedSignature !== previousMemory.transientSignature) {
    const memory = {
      transientSignature: completedSignature,
      transientAction: 'jumping' as PetSpriteAction,
      transientUntil: input.now + COMPLETED_TRANSIENT_MS,
    };
    return {
      action: 'jumping',
      motionSpeed: 0,
      memory,
      nextWakeDelayMs: COMPLETED_TRANSIENT_MS,
    };
  }

  if (
    previousMemory.transientAction
    && previousMemory.transientUntil > input.now
  ) {
    return {
      action: previousMemory.transientAction,
      motionSpeed: 0,
      memory: previousMemory,
      nextWakeDelayMs: Math.max(16, previousMemory.transientUntil - input.now),
    };
  }

  const memory = previousMemory.transientAction
    ? {
      ...previousMemory,
      transientAction: null,
      transientUntil: 0,
    }
    : previousMemory;

  if (input.interaction.kind === 'hover') {
    return {
      action: 'waving',
      motionSpeed: 0,
      memory,
      nextWakeDelayMs: null,
    };
  }

  return {
    action: baseTaskAction(input),
    motionSpeed: 0,
    memory,
    nextWakeDelayMs: null,
  };
}

