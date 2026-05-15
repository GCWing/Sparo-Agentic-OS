import { describe, expect, it } from 'vitest';
import type { AgentCompanionTaskStatus, AgentCompanionTaskState } from '@/flow_chat/utils/agentCompanionActivity';
import { resolvePetRenderAction } from './petActionMapper';
import {
  EMPTY_PET_BEHAVIOR_MEMORY,
  resolvePetBehavior,
} from './petBehaviorMachine';
import { PetMotionTracker } from './petMotionTracker';

function task(
  state: AgentCompanionTaskState,
  updatedAt = 1000,
): AgentCompanionTaskStatus {
  return {
    sessionId: `session-${state}`,
    title: 'Session',
    mood: state === 'waiting' || state === 'attention' ? 'waiting' : 'rest',
    state,
    labelKey: 'agentCompanion.activity.working',
    defaultLabel: 'Working',
    startedAt: updatedAt - 100,
    updatedAt,
  };
}

describe('pet runtime', () => {
  it('maps the current 9-row pet atlas actions to rows and frame counts', () => {
    expect(resolvePetRenderAction('idle')).toMatchObject({ row: 0, frames: 6, frameEnd: '85.714286%' });
    expect(resolvePetRenderAction('running-right')).toMatchObject({ row: 1, frames: 8, frameEnd: '114.285714%' });
    expect(resolvePetRenderAction('running-left')).toMatchObject({ row: 2, frames: 8 });
    expect(resolvePetRenderAction('waving')).toMatchObject({ row: 3, frames: 4, frameEnd: '57.142857%' });
    expect(resolvePetRenderAction('jumping')).toMatchObject({ row: 4, frames: 5 });
    expect(resolvePetRenderAction('failed')).toMatchObject({ row: 5, frames: 8 });
    expect(resolvePetRenderAction('waiting')).toMatchObject({ row: 6, frames: 6 });
    expect(resolvePetRenderAction('running')).toMatchObject({ row: 7, frames: 6 });
    expect(resolvePetRenderAction('review')).toMatchObject({ row: 8, frames: 6 });
  });

  it('speeds up directional running without changing non-movement actions', () => {
    const slowRun = resolvePetRenderAction('running-right', 0);
    const fastRun = resolvePetRenderAction('running-right', 1200);
    const idle = resolvePetRenderAction('idle', 1200);

    expect(fastRun.durationMs).toBeLessThan(slowRun.durationMs);
    expect(idle.durationMs).toBe(2400);
  });

  it('tracks drag direction and speed after the drag threshold', () => {
    const tracker = new PetMotionTracker();
    tracker.begin({ x: 100, y: 100, timeStamp: 0 });

    expect(tracker.update({ x: 104, y: 100, timeStamp: 16 })).toBeNull();
    expect(tracker.update({ x: 80, y: 100, timeStamp: 40 })).toMatchObject({
      direction: 'left',
    });
    expect(tracker.isDragging()).toBe(true);
  });

  it('updates direction while an active drag continues', () => {
    const tracker = new PetMotionTracker();
    tracker.begin({ x: 100, y: 100, timeStamp: 0 });

    expect(tracker.update({ x: 120, y: 100, timeStamp: 40 })).toMatchObject({
      direction: 'right',
    });
    expect(tracker.updateActive({ x: 80, y: 100, timeStamp: 80 })).toMatchObject({
      direction: 'left',
    });
    expect(tracker.updateFromWindowMovement(32, 0, 32)).toMatchObject({
      direction: 'right',
    });
  });

  it('prioritizes dragging over agent state', () => {
    const result = resolvePetBehavior({
      mood: 'waiting',
      tasks: [task('attention')],
      interaction: { kind: 'dragging', motion: { direction: 'left', speed: 900 } },
      now: 1000,
    }, EMPTY_PET_BEHAVIOR_MEMORY);

    expect(result.action).toBe('running-left');
    expect(result.motionSpeed).toBe(900);
  });

  it('maps active agent moods to the new pet action semantics', () => {
    expect(resolvePetBehavior({
      mood: 'analyzing',
      tasks: [],
      interaction: { kind: 'none' },
      now: 1000,
    }, EMPTY_PET_BEHAVIOR_MEMORY).action).toBe('review');

    expect(resolvePetBehavior({
      mood: 'working',
      tasks: [],
      interaction: { kind: 'none' },
      now: 1000,
    }, EMPTY_PET_BEHAVIOR_MEMORY).action).toBe('running');
  });

  it('plays completed and failed as one-shot transient actions', () => {
    const completed = resolvePetBehavior({
      mood: 'rest',
      tasks: [task('completed', 2000)],
      interaction: { kind: 'none' },
      now: 3000,
    }, EMPTY_PET_BEHAVIOR_MEMORY);

    expect(completed.action).toBe('jumping');
    expect(completed.nextWakeDelayMs).toBe(1600);

    const afterCompleted = resolvePetBehavior({
      mood: 'rest',
      tasks: [task('completed', 2000)],
      interaction: { kind: 'none' },
      now: 4700,
    }, completed.memory);

    expect(afterCompleted.action).toBe('idle');

    const failed = resolvePetBehavior({
      mood: 'rest',
      tasks: [task('error', 3000)],
      interaction: { kind: 'none' },
      now: 5000,
    }, afterCompleted.memory);

    expect(failed.action).toBe('failed');
    expect(failed.nextWakeDelayMs).toBe(1500);
  });
});
