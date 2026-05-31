import { useCallback, useRef, useSyncExternalStore } from 'react';
import { flowChatStore } from '../store/FlowChatStore';
import type { FlowChatState } from '../types/flow-chat';

const objectIs = <T>(left: T, right: T): boolean => Object.is(left, right);

export function useFlowChatStoreSelector<T>(
  selector: (state: FlowChatState) => T,
  equality: (left: T, right: T) => boolean = objectIs,
): T {
  const selectorRef = useRef(selector);
  const equalityRef = useRef(equality);
  const snapshotRef = useRef<{
    state: FlowChatState;
    selected: T;
  } | null>(null);

  selectorRef.current = selector;
  equalityRef.current = equality;

  const getSnapshot = useCallback(() => {
    const state = flowChatStore.getState();
    const previous = snapshotRef.current;
    if (previous?.state === state) {
      return previous.selected;
    }

    const nextSelected = selectorRef.current(state);
    if (previous && equalityRef.current(previous.selected, nextSelected)) {
      snapshotRef.current = { state, selected: previous.selected };
      return previous.selected;
    }

    snapshotRef.current = { state, selected: nextSelected };
    return nextSelected;
  }, []);

  const subscribe = useCallback((onStoreChange: () => void) =>
    flowChatStore.subscribeSelector(
      (state) => selectorRef.current(state),
      () => onStoreChange(),
      (left, right) => equalityRef.current(left, right),
    ), []);

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
}
