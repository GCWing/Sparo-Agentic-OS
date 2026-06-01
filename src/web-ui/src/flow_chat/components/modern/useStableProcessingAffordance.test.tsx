/**
 * @vitest-environment jsdom
 */

import React, { useEffect } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStableProcessingAffordance, type StableProcessingAffordance } from './useStableProcessingAffordance';
import type { ProcessingAffordanceProjection } from '../../projections/processingAffordanceProjection';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function ambientProjection(activityKey = 'round-1'): ProcessingAffordanceProjection {
  return {
    kind: 'ambient_wait',
    reason: 'between_visible_steps',
    reserveSpace: true,
    activeTurnId: 'turn-1',
    latestVisibleActivityKey: activityKey,
  };
}

const hiddenProjection: ProcessingAffordanceProjection = {
  kind: 'none',
  reserveSpace: false,
};

function Probe({
  projection,
  onValue,
}: {
  projection: ProcessingAffordanceProjection;
  onValue: (value: StableProcessingAffordance) => void;
}) {
  const value = useStableProcessingAffordance(projection);

  useEffect(() => {
    onValue(value);
  }, [onValue, value]);

  return null;
}

describe('useStableProcessingAffordance', () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: StableProcessingAffordance | undefined;
  const onValue = (value: StableProcessingAffordance) => {
    latest = value;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    latest = undefined;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
    vi.useRealTimers();
  });

  it('waits 3 seconds before showing ambient waiting', () => {
    act(() => {
      root.render(<Probe projection={ambientProjection()} onValue={onValue} />);
    });

    expect(latest?.visible).toBe(false);
    expect(latest?.reserveSpace).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(latest?.visible).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(latest?.visible).toBe(true);
  });

  it('hides immediately when another visible affordance owns the processing state', () => {
    act(() => {
      root.render(<Probe projection={ambientProjection()} onValue={onValue} />);
    });

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(latest?.visible).toBe(true);

    act(() => {
      root.render(<Probe projection={hiddenProjection} onValue={onValue} />);
    });

    expect(latest?.visible).toBe(false);
    expect(latest?.reserveSpace).toBe(false);
  });

  it('restarts the 3 second delay when the visible activity changes', () => {
    act(() => {
      root.render(<Probe projection={ambientProjection('round-1')} onValue={onValue} />);
      vi.advanceTimersByTime(2000);
    });
    expect(latest?.visible).toBe(false);

    act(() => {
      root.render(<Probe projection={ambientProjection('round-2')} onValue={onValue} />);
    });

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(latest?.visible).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(latest?.visible).toBe(true);
  });
});
