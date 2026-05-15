import type { PetMotionSnapshot } from './petTypes';

export const PET_DRAG_THRESHOLD_PX = 8;
export const PET_DRAG_DIRECTION_CHANGE_THRESHOLD_PX = 3;
export const PET_FAST_DRAG_SPEED_PX_PER_SECOND = 720;
export const PET_SETTLE_DURATION_MS = 340;
export const PET_DRAG_STOP_IDLE_MS = 320;

export interface PetPointerSample {
  x: number;
  y: number;
  timeStamp: number;
}

interface PetPointerSession extends PetPointerSample {
  lastX: number;
  lastY: number;
  lastAt: number;
  dragStarted: boolean;
}

export class PetMotionTracker {
  private session: PetPointerSession | null = null;
  private lastMotion: PetMotionSnapshot | null = null;

  begin(sample: PetPointerSample): void {
    this.session = {
      ...sample,
      lastX: sample.x,
      lastY: sample.y,
      lastAt: sample.timeStamp,
      dragStarted: false,
    };
    this.lastMotion = null;
  }

  update(sample: PetPointerSample): PetMotionSnapshot | null {
    if (!this.session) {
      return null;
    }

    if (this.session.dragStarted) {
      return this.updateActive(sample);
    }

    const totalDx = sample.x - this.session.x;
    const totalDy = sample.y - this.session.y;
    const frameDt = Math.max(16, sample.timeStamp - this.session.lastAt);
    const frameDx = sample.x - this.session.lastX;
    const frameDy = sample.y - this.session.lastY;
    const frameSpeed = Math.hypot(frameDx, frameDy) / frameDt * 1000;
    this.session.lastX = sample.x;
    this.session.lastY = sample.y;
    this.session.lastAt = sample.timeStamp;

    if (totalDx * totalDx + totalDy * totalDy < PET_DRAG_THRESHOLD_PX * PET_DRAG_THRESHOLD_PX) {
      return null;
    }

    this.session.dragStarted = true;
    const elapsed = Math.max(16, sample.timeStamp - this.session.timeStamp);
    const averageSpeed = Math.hypot(totalDx, totalDy) / elapsed * 1000;
    const motion = {
      direction: totalDx < 0 ? 'left' : 'right',
      speed: Math.max(frameSpeed, averageSpeed),
    } satisfies PetMotionSnapshot;
    this.lastMotion = motion;

    return motion;
  }

  updateActive(sample: PetPointerSample): PetMotionSnapshot | null {
    if (!this.session?.dragStarted) {
      return null;
    }

    const frameDt = Math.max(16, sample.timeStamp - this.session.lastAt);
    const frameDx = sample.x - this.session.lastX;
    const frameDy = sample.y - this.session.lastY;
    const frameSpeed = Math.hypot(frameDx, frameDy) / frameDt * 1000;
    this.session.lastX = sample.x;
    this.session.lastY = sample.y;
    this.session.lastAt = sample.timeStamp;

    const previousDirection = this.lastMotion?.direction ?? 'right';
    const direction = Math.abs(frameDx) >= PET_DRAG_DIRECTION_CHANGE_THRESHOLD_PX
      ? frameDx < 0 ? 'left' : 'right'
      : previousDirection;
    const motion = {
      direction,
      speed: Math.max(frameSpeed, this.lastMotion?.speed ?? 0),
    } satisfies PetMotionSnapshot;
    this.lastMotion = motion;

    return motion;
  }

  updateFromWindowMovement(
    dx: number,
    dy: number,
    elapsedMs: number,
  ): PetMotionSnapshot | null {
    if (!this.session?.dragStarted) {
      return null;
    }

    const speed = Math.hypot(dx, dy) / Math.max(16, elapsedMs) * 1000;
    const previousDirection = this.lastMotion?.direction ?? 'right';
    const direction = Math.abs(dx) >= PET_DRAG_DIRECTION_CHANGE_THRESHOLD_PX
      ? dx < 0 ? 'left' : 'right'
      : previousDirection;
    const motion = {
      direction,
      speed: Math.max(speed, this.lastMotion?.speed ?? 0),
    } satisfies PetMotionSnapshot;
    this.lastMotion = motion;

    return motion;
  }

  isDragging(): boolean {
    return this.session?.dragStarted ?? false;
  }

  reset(): void {
    this.session = null;
    this.lastMotion = null;
  }
}
