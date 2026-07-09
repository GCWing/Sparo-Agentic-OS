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
    selector: (state: FlowChatState) => T;
    selected: T;
  } | null>(null);

  selectorRef.current = selector;
  equalityRef.current = equality;

  const getSnapshot = useCallback(() => {
    const state = flowChatStore.getState();
    const selector = selectorRef.current;
    const previous = snapshotRef.current;

    // The selector is part of the snapshot identity. Several call sites compose
    // FlowChatStore with another external store by closing over values such as
    // focusedSessionId; when that value changes, React re-renders even if the
    // FlowChatStore state object is unchanged.
    if (previous?.state === state && previous.selector === selector) {
      return previous.selected;
    }

    const nextSelected = selector(state);
    if (previous && equalityRef.current(previous.selected, nextSelected)) {
      snapshotRef.current = { state, selector, selected: previous.selected };
      return previous.selected;
    }

    snapshotRef.current = { state, selector, selected: nextSelected };
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
