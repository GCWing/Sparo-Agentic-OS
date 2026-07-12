/**
 * FlowChat navigation side effects.
 *
 * Handles cross-session focus requests and turn pinning events for the modern
 * virtualized list.
 */

import { useEffect, type RefObject } from 'react';
import { globalEventBus } from '@/infrastructure/event-bus';
import { createLogger } from '@/shared/utils/logger';
import { flowChatStore } from '../../store/FlowChatStore';
import { useModernFlowChatStore, type VirtualItem } from '../../store/modernFlowChatStore';
import { openSession } from '@/app/navigation/navigationController';
import {
  FLOWCHAT_FOCUS_ITEM_EVENT,
  type FlowChatFocusItemRequest,
} from '../../events/flowchatNavigation';
import type { VirtualMessageListRef } from './VirtualMessageList';
import {
  acknowledgeFlowViewportTurnNavigation,
  requestFlowViewportTurnNavigation,
} from '../../scroll/viewport/FlowViewportNavigationBroker';

const log = createLogger('useFlowChatNavigation');

interface UseFlowChatNavigationOptions {
  activeSessionId?: string;
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
  virtualListRef,
}: UseFlowChatNavigationOptions): void {
  useEffect(() => {
    const unsubscribe = globalEventBus.on<FlowChatFocusItemRequest>(FLOWCHAT_FOCUS_ITEM_EVENT, async (request) => {
      const { sessionId, itemId } = request;
      if (!sessionId) return;

      const stagedTarget = resolveFocusTarget(request, []);
      let stagedPinnedRequestId: number | null = null;
      if (stagedTarget.preferPinnedTurnNavigation && stagedTarget.resolvedTurnId) {
        const viewportRequest = requestFlowViewportTurnNavigation({
          sessionId,
          turnId: stagedTarget.resolvedTurnId,
          source: 'btw-back',
          behavior: 'auto',
        });
        stagedPinnedRequestId = viewportRequest.requestId;
      }

      if (activeSessionId !== sessionId) {
        try {
          await openSession(sessionId);
        } catch (error) {
          if (stagedPinnedRequestId !== null) {
            acknowledgeFlowViewportTurnNavigation(sessionId, stagedPinnedRequestId);
          }
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

      if (resolvedTarget.preferPinnedTurnNavigation && resolvedTarget.resolvedTurnId) {
        if (stagedPinnedRequestId === null) {
          requestFlowViewportTurnNavigation({
            sessionId,
            turnId: resolvedTarget.resolvedTurnId,
            source: 'btw-back',
            behavior: 'auto',
          });
        }
      } else {
        navigateToResolvedTarget(virtualListRef, resolvedTarget);
      }

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
