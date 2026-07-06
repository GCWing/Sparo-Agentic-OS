/**
 * FlowChat navigation side effects.
 *
 * Handles cross-session focus requests and turn pinning events for the modern
 * virtualized list.
 */

import { useEffect, useState, type RefObject } from 'react';
import { globalEventBus } from '@/infrastructure/event-bus';
import { createLogger } from '@/shared/utils/logger';
import { flowChatStore } from '../../store/FlowChatStore';
import { useModernFlowChatStore, type VirtualItem } from '../../store/modernFlowChatStore';
import { openSession } from '@/app/navigation/navigationController';
import {
  FLOWCHAT_FOCUS_ITEM_EVENT,
  FLOWCHAT_PIN_TURN_TO_TOP_EVENT,
  type FlowChatFocusItemRequest,
  type FlowChatPinTurnToTopRequest,
} from '../../events/flowchatNavigation';
import type { VirtualMessageListRef } from './VirtualMessageList';

const log = createLogger('useFlowChatNavigation');

interface UseFlowChatNavigationOptions {
  activeSessionId?: string;
  virtualItems: VirtualItem[];
  virtualListRef: RefObject<VirtualMessageListRef | null>;
}

interface ResolvedFocusTarget {
  resolvedVirtualIndex?: number;
  resolvedTurnId?: string;
  resolvedTurnIndex?: number;
  preferPinnedTurnNavigation: boolean;
}

async function waitForCondition(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
  return predicate();
}

async function waitForAnimationFrames(frameCount: number): Promise<void> {
  let remaining = Math.max(0, frameCount);
  while (remaining > 0) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    remaining -= 1;
  }
}

function resolveFocusTarget(
  request: FlowChatFocusItemRequest,
  currentVirtualItems: VirtualItem[],
): ResolvedFocusTarget {
  const { sessionId, turnIndex, itemId, source } = request;
  let resolvedVirtualIndex: number | undefined = undefined;
  let resolvedTurnIndex = turnIndex;
  let resolvedTurnId: string | undefined = undefined;
  const targetSession = flowChatStore.getState().sessions.get(sessionId);

  if (targetSession && turnIndex && turnIndex >= 1 && turnIndex <= targetSession.dialogTurns.length) {
    resolvedTurnId = targetSession.dialogTurns[turnIndex - 1]?.id;
  }

  if (itemId) {
    if (targetSession) {
      for (let i = 0; i < targetSession.dialogTurns.length; i += 1) {
        const turn = targetSession.dialogTurns[i];
        const found = turn.modelRounds?.some(round => round.items?.some(item => item.id === itemId));
        if (found) {
          resolvedTurnIndex = i + 1;
          resolvedTurnId = turn.id;
          break;
        }
      }
    }

    for (let i = 0; i < currentVirtualItems.length; i += 1) {
      const item = currentVirtualItems[i];
      if (item.type === 'model-round') {
        const hit = item.data?.items?.some(flowItem => flowItem?.id === itemId);
        if (hit) {
          resolvedVirtualIndex = i;
          break;
        }
      } else if (item.type === 'explore-group') {
        const hit = item.data?.allItems?.some(flowItem => flowItem?.id === itemId);
        if (hit) {
          resolvedVirtualIndex = i;
          break;
        }
      }
    }
  }

  return {
    resolvedVirtualIndex,
    resolvedTurnId,
    resolvedTurnIndex,
    preferPinnedTurnNavigation: source === 'btw-back',
  };
}

function navigateToResolvedTarget(
  virtualListRef: RefObject<VirtualMessageListRef | null>,
  target: ResolvedFocusTarget,
): void {
  const list = virtualListRef.current;
  if (!list) return;

  if (target.preferPinnedTurnNavigation && target.resolvedTurnId) {
    list.pinTurnToTop(target.resolvedTurnId, { behavior: 'auto' });
    return;
  }

  if (target.resolvedVirtualIndex != null) {
    list.scrollToIndex(target.resolvedVirtualIndex);
    return;
  }

  if (target.resolvedTurnIndex) {
    list.scrollToTurn(target.resolvedTurnIndex);
  }
}

export function useFlowChatNavigation({
  activeSessionId,
  virtualItems,
  virtualListRef,
}: UseFlowChatNavigationOptions): void {
  const [pendingTurnPinRequest, setPendingTurnPinRequest] = useState<FlowChatPinTurnToTopRequest | null>(null);

  useEffect(() => {
    const unsubscribe = globalEventBus.on<FlowChatPinTurnToTopRequest>(FLOWCHAT_PIN_TURN_TO_TOP_EVENT, (request) => {
      if (!request || request.sessionId !== activeSessionId) {
        return;
      }

      setPendingTurnPinRequest(request);
    });

    return unsubscribe;
  }, [activeSessionId]);

  useEffect(() => {
    if (!pendingTurnPinRequest) return;
    if (pendingTurnPinRequest.sessionId !== activeSessionId) {
      setPendingTurnPinRequest(null);
      return;
    }

    const accepted = virtualListRef.current?.pinTurnToTop(pendingTurnPinRequest.turnId, {
      behavior: pendingTurnPinRequest.behavior ?? 'auto',
      pinMode: pendingTurnPinRequest.pinMode,
    }) ?? false;
    if (accepted) {
      setPendingTurnPinRequest(null);
    }
  }, [activeSessionId, pendingTurnPinRequest, virtualItems, virtualListRef]);

  useEffect(() => {
    const unsubscribe = globalEventBus.on<FlowChatFocusItemRequest>(FLOWCHAT_FOCUS_ITEM_EVENT, async (request) => {
      const { sessionId, itemId } = request;
      if (!sessionId) return;

      if (activeSessionId !== sessionId) {
        try {
          await openSession(sessionId);
        } catch (error) {
          log.warn('Failed to switch session for focus request', { sessionId, error });
          return;
        }
      }

      await waitForCondition(() => {
        const modernActiveSessionId = useModernFlowChatStore.getState().activeSession?.sessionId;
        return modernActiveSessionId === sessionId && !!virtualListRef.current;
      }, 1500);

      const resolvedTarget = resolveFocusTarget(
        request,
        useModernFlowChatStore.getState().virtualItems,
      );

      navigateToResolvedTarget(virtualListRef, resolvedTarget);

      if (!itemId) return;

      await waitForAnimationFrames(2);

      const maxAttempts = 120;
      let attempts = 0;
      const tryFocus = () => {
        attempts += 1;
        const element = document.querySelector(`[data-flow-item-id="${CSS.escape(itemId)}"]`) as HTMLElement | null;
        if (!element) {
          if (attempts % 12 === 0 && !resolvedTarget.preferPinnedTurnNavigation) {
            navigateToResolvedTarget(virtualListRef, resolvedTarget);
          }
          if (attempts < maxAttempts) {
            requestAnimationFrame(tryFocus);
          }
          return;
        }

        element.classList.add('flowchat-flow-item--focused');
        window.setTimeout(() => element.classList.remove('flowchat-flow-item--focused'), 1600);
      };

      requestAnimationFrame(tryFocus);
    });

    return unsubscribe;
  }, [activeSessionId, virtualListRef]);
}
