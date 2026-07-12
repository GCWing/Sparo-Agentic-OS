/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FlowViewportScheduler,
  type FlowViewportHost,
} from './FlowViewportScheduler';

interface TestTurn {
  index: number;
  top: number;
  height?: number;
  mounted?: boolean;
}

interface ViewportHarness {
  scheduler: FlowViewportScheduler;
  scroller: HTMLElement;
  footer: HTMLElement;
  virtuosoScrollToIndex: ReturnType<typeof vi.fn>;
  setLayout: (options: {
    contentHeight: number;
    latestTurnId: string;
    turns: Record<string, TestTurn>;
  }) => void;
  setLatestTurn: (turnId: string) => void;
  mountTurn: (turnId: string) => void;
}

const INPUT_FOOTER_PX = 100;
const VIEWPORT_HEIGHT_PX = 800;

let nowMs = 0;
let nextFrameId = 1;
let frameQueue = new Map<number, FrameRequestCallback>();
const schedulers: FlowViewportScheduler[] = [];

beforeEach(() => {
  nowMs = 0;
  nextFrameId = 1;
  frameQueue = new Map();

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    frameQueue.set(frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (frameId: number) => {
    frameQueue.delete(frameId);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
});

afterEach(() => {
  schedulers.forEach(scheduler => scheduler.dispose());
  schedulers.length = 0;
  frameQueue.clear();
  delete window.__flowChatPerf;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function createRect(top: number, height: number, width = 640): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    right: width,
    bottom: top + height,
    left: 0,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function parsePx(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flushUntilIdle(maxFrames = 40): void {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    if (frameQueue.size === 0) return;

    const callbacks = [...frameQueue.values()];
    frameQueue.clear();
    nowMs += 16;
    callbacks.forEach(callback => callback(nowMs));
  }

  throw new Error(`Viewport scheduler did not become idle after ${maxFrames} frames`);
}

function createHarness(): ViewportHarness {
  const scroller = document.createElement('div');
  const footer = document.createElement('div');
  let scrollTop = 0;
  let contentHeight = 0;
  let latestTurnId = '';
  let turns = new Map<string, TestTurn>();

  Object.defineProperties(scroller, {
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Number(value);
      },
    },
    scrollHeight: {
      configurable: true,
      get: () => contentHeight + parsePx(footer.style.height, INPUT_FOOTER_PX),
    },
    clientHeight: {
      configurable: true,
      get: () => VIEWPORT_HEIGHT_PX,
    },
  });
  Object.defineProperty(footer, 'offsetHeight', {
    configurable: true,
    get: () => parsePx(footer.style.height, INPUT_FOOTER_PX),
  });
  scroller.getBoundingClientRect = () => createRect(0, VIEWPORT_HEIGHT_PX);

  const elements = new Map<string, HTMLElement>();
  const getTurnElement = (turnId: string): HTMLElement => {
    let element = elements.get(turnId);
    if (!element) {
      element = document.createElement('div');
      element.getBoundingClientRect = () => {
        const turn = turns.get(turnId);
        if (!turn) return createRect(0, 0);
        return createRect(turn.top - scrollTop, turn.height ?? 40);
      };
      elements.set(turnId, element);
    }
    return element;
  };

  const virtuosoScrollToIndex = vi.fn();
  const host: FlowViewportHost = {
    getScroller: () => scroller,
    getFooter: () => footer,
    getInputFooterPx: () => INPUT_FOOTER_PX,
    isStreaming: () => false,
    getLatestTurnId: () => latestTurnId || null,
    findUserMessageIndex: turnId => turns.get(turnId)?.index ?? -1,
    getUserMessageElement: turnId => {
      const turn = turns.get(turnId);
      return turn?.mounted ? getTurnElement(turnId) : null;
    },
    virtuosoScrollToIndex: (index, align, behavior) => {
      virtuosoScrollToIndex(index, align, behavior);
    },
    onVisibleTurnMeasure: vi.fn(),
  };

  const scheduler = new FlowViewportScheduler(host);
  schedulers.push(scheduler);

  return {
    scheduler,
    scroller,
    footer,
    virtuosoScrollToIndex,
    setLayout: options => {
      contentHeight = options.contentHeight;
      latestTurnId = options.latestTurnId;
      turns = new Map(Object.entries(options.turns));
    },
    setLatestTurn: turnId => {
      latestTurnId = turnId;
    },
    mountTurn: turnId => {
      const turn = turns.get(turnId);
      if (!turn) throw new Error(`Unknown turn: ${turnId}`);
      turns.set(turnId, { ...turn, mounted: true });
    },
  };
}

function expectPinnedLatest(harness: ViewportHarness, turnId: string): void {
  const diagnostics = harness.scheduler.getDiagnostics();
  expect(diagnostics.mode.kind).toBe('pinned-latest');
  expect(diagnostics.latestTurnLayout?.owner.turnId).toBe(turnId);
  expect(diagnostics.latestTurnLayout?.phase).toBe('active');
}

describe('FlowViewportScheduler', () => {
  it('rebuilds the new session latest floor after an older-turn detour without inheriting the previous session floor', () => {
    const harness = createHarness();
    harness.setLayout({
      contentHeight: 1400,
      latestTurnId: 'turn-a2',
      turns: {
        'turn-a2': { index: 1, top: 1181, mounted: true },
      },
    });

    harness.scheduler.enterSession('session-a', 'turn-a2', null);
    flushUntilIdle();

    const sessionALayout = harness.scheduler.getDiagnostics().latestTurnLayout;
    expectPinnedLatest(harness, 'turn-a2');
    expect(sessionALayout?.floorPx).toBeCloseTo(420);

    harness.setLayout({
      contentHeight: 1800,
      latestTurnId: 'turn-b3',
      turns: {
        'turn-b1': { index: 0, top: 200, mounted: true },
        'turn-b3': { index: 2, top: 1421, mounted: false },
      },
    });
    harness.scheduler.enterSession('session-b', 'turn-b3', 'turn-b1');
    flushUntilIdle();

    const dormantLayout = harness.scheduler.getDiagnostics().latestTurnLayout;
    expect(harness.scheduler.getMode()).toEqual({ kind: 'reading' });
    expect(dormantLayout?.owner.sessionId).toBe('session-b');
    expect(dormantLayout?.owner.turnId).toBe('turn-b3');
    expect(dormantLayout?.owner.epoch).toBeGreaterThan(sessionALayout?.owner.epoch ?? 0);
    expect(dormantLayout?.phase).toBe('dormant');
    expect(dormantLayout?.floorPx).toBe(0);
    expect(harness.scheduler.getDiagnostics().totalCompensationPx).toBe(0);

    harness.mountTurn('turn-b3');
    harness.scheduler.handleRangeChanged();
    flushUntilIdle();

    const materializedLayout = harness.scheduler.getDiagnostics().latestTurnLayout;
    expect(harness.scheduler.getMode()).toEqual({ kind: 'reading' });
    expect(materializedLayout?.owner).toEqual(dormantLayout?.owner);
    expect(materializedLayout?.phase).toBe('dormant');
    expect(materializedLayout?.floorPx).toBeCloseTo(260);

    // Native downward reading traverses the dormant page range. Reaching the
    // measured layout boundary activates latest without a content-bottom snap.
    harness.scroller.scrollTop = harness.scroller.scrollHeight - harness.scroller.clientHeight;
    harness.scheduler.handleScrollEvent();
    flushUntilIdle();

    const rebuiltLayout = harness.scheduler.getDiagnostics().latestTurnLayout;
    expectPinnedLatest(harness, 'turn-b3');
    expect(rebuiltLayout?.owner).toEqual(dormantLayout?.owner);
    expect(rebuiltLayout?.floorPx).toBeCloseTo(260);
    expect(rebuiltLayout?.floorPx).not.toBeCloseTo(sessionALayout?.floorPx ?? 0);
  });

  it('replaces the latest owner epoch across sync and submit and ignores a stale settle from the retired owner', () => {
    const harness = createHarness();
    harness.setLayout({
      contentHeight: 1800,
      latestTurnId: 'turn-b3',
      turns: {
        'turn-b3': { index: 2, top: 1421, mounted: true },
        'turn-b4': { index: 3, top: 1441, mounted: false },
      },
    });
    harness.scheduler.enterSession('session-b', 'turn-b3', null);
    flushUntilIdle();

    const retiredLayout = harness.scheduler.getDiagnostics().latestTurnLayout;
    expectPinnedLatest(harness, 'turn-b3');
    expect(retiredLayout?.floorPx).toBeCloseTo(260);

    harness.setLayout({
      contentHeight: 2000,
      latestTurnId: 'turn-b4',
      turns: {
        'turn-b3': { index: 2, top: 1421, mounted: true },
        'turn-b4': { index: 3, top: 1441, mounted: false },
      },
    });
    harness.scheduler.syncLatestTurn('session-b', 'turn-b4');
    flushUntilIdle();

    const syncedLayout = harness.scheduler.getDiagnostics().latestTurnLayout;
    expect(harness.scheduler.getMode()).toEqual({ kind: 'reading' });
    expect(syncedLayout?.owner.turnId).toBe('turn-b4');
    expect(syncedLayout?.owner.epoch).toBeGreaterThan(retiredLayout?.owner.epoch ?? 0);
    expect(syncedLayout?.phase).toBe('dormant');
    expect(syncedLayout?.floorPx).toBe(0);

    harness.mountTurn('turn-b4');
    expect(harness.scheduler.submitLatestTurn('session-b', 'turn-b4')).toBe(true);
    const activatingLayout = harness.scheduler.getDiagnostics().latestTurnLayout;
    expect(activatingLayout?.owner).toEqual(syncedLayout?.owner);
    expect(harness.scheduler.getMode().kind).toBe('navigating');

    harness.scheduler.dispatch({
      type: 'NAVIGATION_SETTLED',
      nowMs,
      ownerEpoch: retiredLayout?.owner.epoch,
    });
    expect(harness.scheduler.getMode().kind).toBe('navigating');
    expect(harness.scheduler.getDiagnostics().latestTurnLayout?.owner).toEqual(syncedLayout?.owner);

    flushUntilIdle();

    const submittedLayout = harness.scheduler.getDiagnostics().latestTurnLayout;
    expectPinnedLatest(harness, 'turn-b4');
    expect(submittedLayout?.owner).toEqual(syncedLayout?.owner);
    expect(submittedLayout?.floorPx).toBeCloseTo(80);
    expect(submittedLayout?.floorPx).not.toBeCloseTo(retiredLayout?.floorPx ?? 0);
  });

  it('hands a static pinned viewport to reading on downward intent when real content remains below', () => {
    const harness = createHarness();
    harness.setLayout({
      contentHeight: 2000,
      latestTurnId: 'turn-1',
      turns: {
        'turn-1': { index: 0, top: 1000, mounted: true },
      },
    });
    harness.scheduler.enterSession('session-1', 'turn-1', null);
    flushUntilIdle();

    expectPinnedLatest(harness, 'turn-1');
    expect(harness.scheduler.getDiagnostics().latestTurnLayout?.floorPx).toBe(0);

    harness.scheduler.handleUserScrollDownIntent();

    expect(harness.scheduler.getMode()).toEqual({ kind: 'reading' });
    expect(harness.scheduler.getDiagnostics().latestTurnLayout?.phase).toBe('dormant');
  });

  it('keeps a static viewport pinned when downward intent would enter only synthetic blank', () => {
    const harness = createHarness();
    harness.setLayout({
      contentHeight: 1200,
      latestTurnId: 'turn-1',
      turns: {
        'turn-1': { index: 0, top: 900, mounted: true },
      },
    });
    harness.scheduler.enterSession('session-1', 'turn-1', null);
    flushUntilIdle();

    expectPinnedLatest(harness, 'turn-1');
    expect(harness.scheduler.getDiagnostics().latestTurnLayout?.floorPx).toBeCloseTo(339);

    harness.scheduler.handleUserScrollDownIntent();

    expectPinnedLatest(harness, 'turn-1');
    expect(harness.scheduler.getDiagnostics().latestTurnLayout?.floorPx).toBeCloseTo(339);
  });
});
