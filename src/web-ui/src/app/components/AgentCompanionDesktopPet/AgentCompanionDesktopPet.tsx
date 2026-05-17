import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listen } from '@tauri-apps/api/event';
import { cursorPosition, getCurrentWindow } from '@tauri-apps/api/window';
import { aiExperienceConfigService, type AgentCompanionPetSelection, type AIExperienceSettings } from '@/infrastructure/config/services/AIExperienceConfigService';
import { Button } from '@/design-system';
import type { ChatInputPetMood } from '@/flow_chat/utils/chatInputPetMood';
import type { AgentCompanionActivityPayload, AgentCompanionTaskStatus } from '@/flow_chat/utils/agentCompanionActivity';
import { createLogger } from '@/shared/utils/logger';
import { AgentCompanionPetSprite } from './AgentCompanionPetSprite';
import {
  EMPTY_PET_BEHAVIOR_MEMORY,
  resolvePetBehavior,
} from './runtime/petBehaviorMachine';
import {
  PET_DRAG_STOP_IDLE_MS,
  PET_SETTLE_DURATION_MS,
  PetMotionTracker,
} from './runtime/petMotionTracker';
import type { PetBehaviorMemory, PetInteractionSnapshot, PetMotionSnapshot } from './runtime/petTypes';
import './AgentCompanionDesktopPet.scss';

const log = createLogger('AgentCompanionDesktopPet');
const DEFAULT_PET_SIZE = 96;
const DEFAULT_PETDEX_DISPLAY_SIZE = { width: 96, height: 104 };
const PETDEX_DESKTOP_SCALE = 0.5;
const LARGE_PETDEX_DESKTOP_SCALE = 1;
const LARGE_AGENT_COMPANION_PET_IDS = new Set(['assistant']);
const WINDOW_MAX_WIDTH = 360;
const WINDOW_MAX_HEIGHT = 240;
const WINDOW_HORIZONTAL_GAP = 8;
const MAX_VISIBLE_BUBBLES = 2;
const BUBBLE_GAP = 6;
const BUBBLE_WIDTH = 146;
const BUBBLE_OUTPUT_TYPEWRITER_INTERVAL_MS = 28;
const WINDOW_EDGE_BUFFER = 4;
const POINTER_HOVER_POLL_INTERVAL_MS = 120;
const IS_WINDOWS_WEBVIEW = /\bWindows\b/i.test(window.navigator.userAgent);

interface TypewriterOutputState {
  target: string;
  visible: string;
}

function seedTypewriterOutput(target: string): string {
  if (target.length <= 1) {
    return '';
  }

  return target.slice(0, -1);
}

function advanceTypewriterOutput(visible: string, target: string): string {
  if (visible === target) {
    return visible;
  }

  if (!target.startsWith(visible)) {
    return target;
  }

  const gap = target.length - visible.length;
  const step = Math.max(1, Math.floor(gap / 8));
  return target.slice(0, visible.length + step);
}

export const AgentCompanionDesktopPet: React.FC = () => {
  const { t } = useTranslation('flow-chat');
  const [pet, setPet] = useState<AgentCompanionPetSelection | null>(
    () => aiExperienceConfigService.getSettings().agent_companion_pet ?? null,
  );
  const [mood, setMood] = useState<ChatInputPetMood>('rest');
  const [tasks, setTasks] = useState<AgentCompanionTaskStatus[]>([]);
  const [typedOutputBySessionId, setTypedOutputBySessionId] = useState<Record<string, TypewriterOutputState>>({});
  const [isHoveringPet, setIsHoveringPet] = useState(false);
  const [isDraggingPet, setIsDraggingPet] = useState(false);
  const [dragMotion, setDragMotion] = useState<PetMotionSnapshot>({ direction: 'right', speed: 0 });
  const [settleMotion, setSettleMotion] = useState<PetMotionSnapshot | null>(null);
  const [, setBehaviorClock] = useState(() => Date.now());
  const [petFrameSize, setPetFrameSize] = useState<{ width: number; height: number } | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const bubblesRef = useRef<HTMLDivElement>(null);
  const outputRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const lastActivitySequenceRef = useRef(0);
  const lastActivityEmittedAtRef = useRef(0);
  const petMotionTrackerRef = useRef(new PetMotionTracker());
  const behaviorMemoryRef = useRef<PetBehaviorMemory>(EMPTY_PET_BEHAVIOR_MEMORY);
  const petHitboxRef = useRef<HTMLDivElement>(null);
  const dragStopTimerRef = useRef<number | null>(null);
  const petPointerSessionRef = useRef<{
    pointerId: number;
    dragStarted: boolean;
    dragMotion: PetMotionSnapshot | null;
    nativeDragStartedAt: number | null;
  } | null>(null);
  const lastDragWindowPositionRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const displayTasks = [...tasks].reverse();
  const activePetSize = pet && petFrameSize
    ? petFrameSize
    : pet
      ? DEFAULT_PETDEX_DISPLAY_SIZE
      : { width: DEFAULT_PET_SIZE, height: DEFAULT_PET_SIZE };
  const petdexScale = pet && LARGE_AGENT_COMPANION_PET_IDS.has(pet.id)
    ? LARGE_PETDEX_DESKTOP_SCALE
    : PETDEX_DESKTOP_SCALE;

  useEffect(() => {
    document.documentElement.classList.add('sparo-agent-companion-window-root');
    document.body.classList.add('sparo-agent-companion-window-body');

    const applySettings = (settings: AIExperienceSettings) => {
      setPet(settings.agent_companion_pet ?? null);
      setPetFrameSize(null);
    };

    void aiExperienceConfigService.getSettingsAsync().then(settings => {
      applySettings(settings);
    });

    let removeTauriListener: (() => void) | null = null;
    void listen<AIExperienceSettings>('agent-companion://settings-updated', event => {
      applySettings(event.payload);
    }).then(unlisten => {
      removeTauriListener = unlisten;
    }).catch(error => {
      log.warn('Failed to listen for Agent companion settings updates', error);
    });

    let removeActivityListener: (() => void) | null = null;
    void listen<AgentCompanionActivityPayload>('agent-companion://activity-updated', event => {
      const emittedAt = event.payload.emittedAt ?? 0;
      const sequence = event.payload.sequence ?? 0;
      if (
        emittedAt < lastActivityEmittedAtRef.current
        || (emittedAt === lastActivityEmittedAtRef.current && sequence <= lastActivitySequenceRef.current)
      ) {
        return;
      }
      lastActivityEmittedAtRef.current = emittedAt;
      lastActivitySequenceRef.current = sequence;
      setMood(event.payload.mood);
      setTasks(event.payload.tasks);
    }).then(unlisten => {
      removeActivityListener = unlisten;
    }).catch(error => {
      log.warn('Failed to listen for Agent companion activity updates', error);
    });

    return () => {
      removeTauriListener?.();
      removeActivityListener?.();
      document.documentElement.classList.remove('sparo-agent-companion-window-root');
      document.body.classList.remove('sparo-agent-companion-window-body');
    };
  }, []);

  useEffect(() => {
    setTypedOutputBySessionId(previous => {
      const next: Record<string, TypewriterOutputState> = {};

      tasks.forEach(task => {
        if (!task.latestOutput) {
          return;
        }

        const previousOutput = previous[task.sessionId];
        next[task.sessionId] = previousOutput
          ? { ...previousOutput, target: task.latestOutput }
          : {
            target: task.latestOutput,
            visible: seedTypewriterOutput(task.latestOutput),
          };
      });

      return next;
    });
  }, [tasks]);

  useEffect(() => {
    const hasTypingOutput = Object.values(typedOutputBySessionId)
      .some(output => output.visible !== output.target);
    if (!hasTypingOutput) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setTypedOutputBySessionId(previous => {
        let changed = false;
        const next: Record<string, TypewriterOutputState> = {};

        Object.entries(previous).forEach(([sessionId, output]) => {
          const visible = advanceTypewriterOutput(output.visible, output.target);
          if (visible !== output.visible) {
            changed = true;
          }
          next[sessionId] = { ...output, visible };
        });

        return changed ? next : previous;
      });
    }, BUBBLE_OUTPUT_TYPEWRITER_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [typedOutputBySessionId]);

  useLayoutEffect(() => {
    outputRefs.current.forEach(element => {
      element.scrollTop = element.scrollHeight;
    });
  }, [typedOutputBySessionId]);

  useLayoutEffect(() => {
    const bubbleCount = tasks.length;
    const bubbleElements = Array.from(bubblesRef.current?.children ?? [])
      .slice(0, MAX_VISIBLE_BUBBLES);
    const visibleBubbleHeight = bubbleElements.reduce(
      (sum, child) => sum + child.getBoundingClientRect().height,
      0,
    ) + Math.max(0, bubbleElements.length - 1) * BUBBLE_GAP;
    const measuredBubbleHeight = bubblesRef.current?.scrollHeight ?? 0;
    const targetBubbleHeight = bubbleCount === 1
      ? activePetSize.height
      : bubbleCount > MAX_VISIBLE_BUBBLES
        ? visibleBubbleHeight
        : measuredBubbleHeight;
    const nextHeight = bubbleCount > 0
      ? Math.max(activePetSize.height, Math.min(WINDOW_MAX_HEIGHT, targetBubbleHeight))
      : activePetSize.height;
    const measuredBubbleWidth = bubbleCount > 0 ? BUBBLE_WIDTH : 0;
    const measuredDockWidth = bubbleCount > 0
      ? measuredBubbleWidth + WINDOW_HORIZONTAL_GAP + activePetSize.width + WINDOW_EDGE_BUFFER
      : Math.max(
        activePetSize.width,
        dockRef.current?.scrollWidth ?? 0,
        dockRef.current?.getBoundingClientRect().width ?? 0,
      );
    const nextWidth = Math.max(
      activePetSize.width,
      Math.min(WINDOW_MAX_WIDTH, Math.ceil(measuredDockWidth)),
    );
    const nextWindowHeight = nextHeight;

    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextWindowHeight)) {
      log.warn('Skipped invalid Agent companion window resize', {
        width: nextWidth,
        height: nextWindowHeight,
      });
      return;
    }

    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('resize_agent_companion_desktop_pet', {
        width: nextWidth,
        height: nextWindowHeight,
      }))
      .catch(error => {
        log.warn('Failed to resize Agent companion window', error);
      });
  }, [activePetSize.height, activePetSize.width, tasks]);

  useEffect(() => {
    if (IS_WINDOWS_WEBVIEW) {
      return;
    }

    const tauriWindow = getCurrentWindow();
    let disposed = false;
    let windowPosition: { x: number; y: number } | null = null;
    let scaleFactor = 1;
    let removeWindowMovedListener: (() => void) | null = null;
    let removeScaleChangedListener: (() => void) | null = null;

    void tauriWindow.outerPosition()
      .then(position => {
        windowPosition = position;
      })
      .catch(error => {
        log.warn('Failed to read Agent companion window position', error);
      });

    void tauriWindow.scaleFactor()
      .then(rawScaleFactor => {
        const nextScaleFactor = Number(rawScaleFactor);
        scaleFactor = Number.isFinite(nextScaleFactor) && nextScaleFactor > 0 ? nextScaleFactor : 1;
      })
      .catch(error => {
        log.warn('Failed to read Agent companion window scale factor', error);
      });

    void tauriWindow.onMoved(event => {
      windowPosition = event.payload;
    }).then(unlisten => {
      if (disposed) {
        unlisten();
      } else {
        removeWindowMovedListener = unlisten;
      }
    }).catch(error => {
      log.warn('Failed to listen for Agent companion window moves', error);
    });

    void tauriWindow.onScaleChanged(event => {
      const nextScaleFactor = Number(event.payload.scaleFactor);
      scaleFactor = Number.isFinite(nextScaleFactor) && nextScaleFactor > 0 ? nextScaleFactor : 1;
    }).then(unlisten => {
      if (disposed) {
        unlisten();
      } else {
        removeScaleChangedListener = unlisten;
      }
    }).catch(error => {
      log.warn('Failed to listen for Agent companion scale changes', error);
    });

    const pollPointerHover = async () => {
      try {
        if (!windowPosition) {
          windowPosition = await tauriWindow.outerPosition();
        }

        const pointer = await cursorPosition();
        if (disposed) {
          return;
        }

        const hitbox = dockRef.current?.querySelector<HTMLElement>('.sparo-agent-companion-window__pet-hitbox');
        if (!hitbox) {
          setIsHoveringPet(false);
          return;
        }

        const hitboxRect = hitbox.getBoundingClientRect();
        const safeScaleFactor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
        const pointerX = (pointer.x - windowPosition.x) / safeScaleFactor;
        const pointerY = (pointer.y - windowPosition.y) / safeScaleFactor;
        const isPointerInsideHitbox = pointerX >= hitboxRect.left
          && pointerX <= hitboxRect.right
          && pointerY >= hitboxRect.top
          && pointerY <= hitboxRect.bottom;

        setIsHoveringPet(isPointerInsideHitbox);
      } catch (error) {
        log.warn('Failed to poll Agent companion pointer hover state', error);
      }
    };

    const intervalId = window.setInterval(() => {
      void pollPointerHover();
    }, POINTER_HOVER_POLL_INTERVAL_MS);
    void pollPointerHover();

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      removeWindowMovedListener?.();
      removeScaleChangedListener?.();
    };
  }, []);

  const showMainWindowFromPet = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('show_main_window');
    } catch (error) {
      log.warn('Failed to show main window from Agent companion pet', error);
    }
  }, []);

  const onContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
  }, []);

  const onPetContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('show_agent_companion_context_menu'))
      .catch(error => {
        log.warn('Failed to show Agent companion context menu', error);
      });
  }, []);

  const clearPetPointerSession = (target: HTMLDivElement, pointerId: number) => {
    const session = petPointerSessionRef.current;
    if (!session || session.pointerId !== pointerId) {
      return;
    }
    petPointerSessionRef.current = null;
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
  };

  const clearDragStopTimer = useCallback(() => {
    if (dragStopTimerRef.current !== null) {
      window.clearTimeout(dragStopTimerRef.current);
      dragStopTimerRef.current = null;
    }
  }, []);

  const finishPetDrag = useCallback((motion: PetMotionSnapshot | null) => {
    clearDragStopTimer();
    petPointerSessionRef.current = null;
    petMotionTrackerRef.current.reset();
    lastDragWindowPositionRef.current = null;
    setIsDraggingPet(false);
    if (!motion) {
      return;
    }

    setSettleMotion(motion);
    window.setTimeout(() => {
      setSettleMotion(current => current === motion ? null : current);
      setBehaviorClock(Date.now());
    }, PET_SETTLE_DURATION_MS);
  }, [clearDragStopTimer]);

  const scheduleDragIdleStop = useCallback(() => {
    clearDragStopTimer();
    dragStopTimerRef.current = window.setTimeout(() => {
      const session = petPointerSessionRef.current;
      if (session?.dragStarted) {
        finishPetDrag(session.dragMotion);
      }
    }, PET_DRAG_STOP_IDLE_MS);
  }, [clearDragStopTimer, finishPetDrag]);

  const updateActiveDragMotion = useCallback((motion: PetMotionSnapshot | null) => {
    if (!motion) {
      return;
    }

    const session = petPointerSessionRef.current;
    if (session) {
      session.dragMotion = motion;
    }
    setDragMotion(previous => (
      previous.direction === motion.direction && Math.abs(previous.speed - motion.speed) < 1
        ? previous
        : motion
    ));
    scheduleDragIdleStop();
  }, [scheduleDragIdleStop]);

  const onPetPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    petPointerSessionRef.current = {
      pointerId: event.pointerId,
      dragStarted: false,
      dragMotion: null,
      nativeDragStartedAt: null,
    };
    petMotionTrackerRef.current.begin({
      x: event.clientX,
      y: event.clientY,
      timeStamp: event.timeStamp,
    });
    setSettleMotion(null);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPetPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = petPointerSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }
    if (session.dragStarted) {
      return;
    }

    const nextDragMotion = petMotionTrackerRef.current.update({
      x: event.clientX,
      y: event.clientY,
      timeStamp: event.timeStamp,
    });
    if (!nextDragMotion) {
      return;
    }

    session.dragStarted = true;
    session.nativeDragStartedAt = Date.now();
    updateActiveDragMotion(nextDragMotion);
    event.preventDefault();
    setIsDraggingPet(true);
    void getCurrentWindow().startDragging()
      .catch(error => {
        log.warn('Failed to start Agent companion window drag', error);
        finishPetDrag(null);
      })
      .finally(() => {
        const activeSession = petPointerSessionRef.current;
        if (!activeSession?.dragStarted || !activeSession.nativeDragStartedAt) {
          return;
        }

        const elapsed = Date.now() - activeSession.nativeDragStartedAt;
        if (elapsed > 180) {
          finishPetDrag(activeSession.dragMotion);
        } else {
          scheduleDragIdleStop();
        }
      });
  };

  const onPetPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = petPointerSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }
    const shouldShowMain = !session.dragStarted;
    const dragMotionOnRelease = session.dragMotion;
    clearPetPointerSession(event.currentTarget, event.pointerId);
    if (!shouldShowMain) {
      finishPetDrag(dragMotionOnRelease);
    }
    if (shouldShowMain) {
      petMotionTrackerRef.current.reset();
      void showMainWindowFromPet();
    }
  };

  const onPetPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = petPointerSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }
    const dragMotionOnCancel = session.dragMotion;
    clearPetPointerSession(event.currentTarget, event.pointerId);
    finishPetDrag(dragMotionOnCancel);
  };

  useEffect(() => {
    if (!isDraggingPet) {
      lastDragWindowPositionRef.current = null;
      return;
    }

    let disposed = false;
    let removeWindowMovedListener: (() => void) | null = null;
    const tauriWindow = getCurrentWindow();

    void tauriWindow.outerPosition()
      .then(position => {
        if (disposed) {
          return;
        }
        lastDragWindowPositionRef.current = {
          x: position.x,
          y: position.y,
          at: performance.now(),
        };
      })
      .catch(error => {
        log.warn('Failed to read Agent companion drag position', error);
      });

    void tauriWindow.onMoved(event => {
      const now = performance.now();
      const previous = lastDragWindowPositionRef.current;
      lastDragWindowPositionRef.current = {
        x: event.payload.x,
        y: event.payload.y,
        at: now,
      };
      if (!previous) {
        return;
      }

      updateActiveDragMotion(petMotionTrackerRef.current.updateFromWindowMovement(
        event.payload.x - previous.x,
        event.payload.y - previous.y,
        now - previous.at,
      ));
    }).then(unlisten => {
      if (disposed) {
        unlisten();
      } else {
        removeWindowMovedListener = unlisten;
      }
    }).catch(error => {
      log.warn('Failed to listen for Agent companion drag moves', error);
    });

    return () => {
      disposed = true;
      removeWindowMovedListener?.();
    };
  }, [finishPetDrag, isDraggingPet, updateActiveDragMotion]);

  const interaction: PetInteractionSnapshot = isDraggingPet
    ? { kind: 'dragging', motion: dragMotion }
    : settleMotion
      ? { kind: 'settling', motion: settleMotion }
      : isHoveringPet
        ? { kind: 'hover' }
        : { kind: 'none' };
  const petBehavior = resolvePetBehavior({
    mood,
    tasks,
    interaction,
    now: Date.now(),
  }, behaviorMemoryRef.current);
  behaviorMemoryRef.current = petBehavior.memory;

  useEffect(() => {
    if (petBehavior.nextWakeDelayMs === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setBehaviorClock(Date.now());
    }, petBehavior.nextWakeDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [petBehavior.nextWakeDelayMs, petBehavior.action]);

  const openTaskSession = async (task: AgentCompanionTaskStatus) => {
    try {
      const [{ invoke }, { emit }] = await Promise.all([
        import('@tauri-apps/api/core'),
        import('@tauri-apps/api/event'),
      ]);
      await emit('agent-companion://open-session', { sessionId: task.sessionId });
      await invoke('show_main_window');
    } catch (error) {
      log.warn('Failed to open Agent companion task session', {
        sessionId: task.sessionId,
        error,
      });
    }
  };

  const handlePetFrameSizeChange = useCallback((size: { width: number; height: number } | null) => {
    setPetFrameSize(size);
  }, []);

  const dockVars = {
    '--sparo-agent-companion-pet-width': `${activePetSize.width}px`,
    '--sparo-agent-companion-pet-height': `${activePetSize.height}px`,
    '--sparo-agent-companion-gap': `${WINDOW_HORIZONTAL_GAP}px`,
  } as React.CSSProperties;
  const isSingleTask = tasks.length === 1;

  return (
    <main
      className="sparo-agent-companion-window"
      onContextMenu={onContextMenu}
    >
      <div
        ref={dockRef}
        className="sparo-agent-companion-window__dock"
        style={dockVars}
      >
        {tasks.length > 0 && (
          <div
            ref={bubblesRef}
            className={`sparo-agent-companion-window__bubbles${isSingleTask ? ' sparo-agent-companion-window__bubbles--single' : ''}`}
            aria-live="polite"
            onDoubleClick={event => event.stopPropagation()}
          >
            {displayTasks.map(task => (
              <Button
                variant="ghost"
                size="small"
                key={task.sessionId}
                className={`sparo-agent-companion-window__bubble sparo-agent-companion-window__bubble--${task.state}${isSingleTask ? ' sparo-agent-companion-window__bubble--single' : ''}`}
                onClick={() => void openTaskSession(task)}
              >
                <span className="sparo-agent-companion-window__bubble-title">
                  {task.title}
                </span>
                <span className="sparo-agent-companion-window__bubble-status">
                  {t(task.labelKey, { defaultValue: task.defaultLabel })}
                </span>
                {isSingleTask && task.latestOutput && (() => {
                  const typedOutput = typedOutputBySessionId[task.sessionId];
                  const visibleOutput = typedOutput?.visible ?? seedTypewriterOutput(task.latestOutput);
                  const targetOutput = typedOutput?.target ?? task.latestOutput;
                  const isTyping = visibleOutput !== targetOutput;
                  const sessionId = task.sessionId;

                  return (
                    <span
                      ref={element => {
                        if (element) {
                          outputRefs.current.set(sessionId, element);
                        } else {
                          outputRefs.current.delete(sessionId);
                        }
                      }}
                      className={`sparo-agent-companion-window__bubble-output${isTyping ? ' sparo-agent-companion-window__bubble-output--typing' : ''}`}
                    >
                      {visibleOutput}
                    </span>
                  );
                })()}
              </Button>
            ))}
          </div>
        )}
        <div
          ref={petHitboxRef}
          className="sparo-agent-companion-window__pet-hitbox"
          onPointerEnter={() => setIsHoveringPet(true)}
          onPointerLeave={() => setIsHoveringPet(false)}
          onPointerDown={onPetPointerDown}
          onPointerMove={onPetPointerMove}
          onPointerUp={onPetPointerUp}
          onPointerCancel={onPetPointerCancel}
          onContextMenu={onPetContextMenu}
        >
          <AgentCompanionPetSprite
            action={petBehavior.action}
            motionSpeed={petBehavior.motionSpeed}
            pet={pet}
            nativePetdexSize
            petdexScale={petdexScale}
            onPetFrameSizeChange={handlePetFrameSizeChange}
            className="sparo-agent-companion-window__pet"
          />
        </div>
      </div>
    </main>
  );
};

export default AgentCompanionDesktopPet;
