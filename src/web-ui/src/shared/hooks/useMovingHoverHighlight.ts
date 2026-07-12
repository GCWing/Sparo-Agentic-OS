import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

export interface MovingHoverHighlightState {
  top: number;
  left: number;
  width: number;
  height: number;
  stretchX: number;
  stretchY: number;
  visible: boolean;
}

const clampTravel = (value: number): number => Math.max(-34, Math.min(34, value));

export function useMovingHoverHighlight<TSurface extends HTMLElement = HTMLElement>() {
  const surfaceRef = useRef<TSurface | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const [highlight, setHighlight] = useState<MovingHoverHighlightState>({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    stretchX: 1,
    stretchY: 1,
    visible: false,
  });

  useEffect(() => {
    return () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
      }
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  const updateHighlight = useCallback((target: HTMLElement) => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const surfaceRect = surface.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = targetRect.top - surfaceRect.top;
    const nextLeft = targetRect.left - surfaceRect.left;

    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }

    setHighlight(previous => {
      const travelY = previous.visible ? clampTravel(nextTop - previous.top) : 0;
      const travelStrength = Math.min(Math.abs(travelY) / 34, 1);

      return {
        top: nextTop,
        left: nextLeft,
        width: targetRect.width,
        height: targetRect.height,
        stretchX: 1 - travelStrength * 0.035,
        stretchY: 1 + travelStrength * 0.1,
        visible: true,
      };
    });

    settleTimerRef.current = window.setTimeout(() => {
      setHighlight(previous => ({
        ...previous,
        stretchX: 1,
        stretchY: 1,
      }));
      settleTimerRef.current = null;
    }, 82);
  }, []);

  const hideHighlight = useCallback(() => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    setHighlight(previous => ({ ...previous, visible: false }));
  }, []);

  const syncHighlightAtPointer = useCallback((itemSelector: string) => {
    const surface = surfaceRef.current;
    const pointer = pointerPositionRef.current;
    if (!surface || !pointer) return;

    const hit = document.elementFromPoint(pointer.x, pointer.y);
    const option = hit?.closest<HTMLElement>(itemSelector);
    if (option && surface.contains(option)) {
      updateHighlight(option);
    } else {
      hideHighlight();
    }
  }, [hideHighlight, updateHighlight]);

  const getSurfaceHandlers = useCallback((itemSelector: string) => ({
    onMouseMove: (event: React.MouseEvent<TSurface>) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
      const option = (event.target as HTMLElement | null)?.closest<HTMLElement>(itemSelector);
      if (option) updateHighlight(option);
    },
    onMouseOver: (event: React.MouseEvent<TSurface>) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
      const option = (event.target as HTMLElement | null)?.closest<HTMLElement>(itemSelector);
      if (option) updateHighlight(option);
    },
    onPointerMove: (event: React.PointerEvent<TSurface>) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
      const option = (event.target as HTMLElement | null)?.closest<HTMLElement>(itemSelector);
      if (option) updateHighlight(option);
    },
    onPointerOver: (event: React.PointerEvent<TSurface>) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
      const option = (event.target as HTMLElement | null)?.closest<HTMLElement>(itemSelector);
      if (option) updateHighlight(option);
    },
    onScrollCapture: () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        syncHighlightAtPointer(itemSelector);
      });
    },
    onMouseLeave: () => {
      pointerPositionRef.current = null;
      hideHighlight();
    },
    onPointerLeave: () => {
      pointerPositionRef.current = null;
      hideHighlight();
    },
  }), [hideHighlight, syncHighlightAtPointer, updateHighlight]);

  const getItemHandlers = useCallback(() => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
      updateHighlight(event.currentTarget);
    },
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
      updateHighlight(event.currentTarget);
    },
  }), [updateHighlight]);

  const setSurfaceElement = useCallback((element: TSurface | null) => {
    surfaceRef.current = element;
  }, []);

  return {
    surfaceRef,
    setSurfaceElement,
    highlight,
    hideHighlight,
    updateHighlight,
    getSurfaceHandlers,
    getItemHandlers,
  };
}
