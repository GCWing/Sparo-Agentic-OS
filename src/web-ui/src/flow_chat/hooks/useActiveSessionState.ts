/**
 * Subscribe to the active session state.
 * Processing status now comes from SessionStateMachine.
 */

import { useState, useEffect } from 'react';
import { stateMachineManager } from '../state-machine';
import { ProcessingPhase } from '../state-machine/types';
import { useFlowChatStoreSelector } from './useFlowChatStoreSelector';

export interface ActiveSessionState {
  sessionId: string | null;
  isProcessing: boolean;
  processingPhase: ProcessingPhase | null;
  error: string | null;
  status: 'active' | 'idle' | 'error';
}

export const useActiveSessionState = (): ActiveSessionState => {
  const activeSessionSnapshot = useFlowChatStoreSelector((state) => {
    const session = state.activeSessionId
      ? state.sessions.get(state.activeSessionId)
      : undefined;
    return {
      sessionId: session?.sessionId || null,
      error: session?.error || null,
      status: session?.status || 'idle',
    };
  }, (left, right) =>
    left.sessionId === right.sessionId &&
    left.error === right.error &&
    left.status === right.status
  );
  const [sessionState, setSessionState] = useState<ActiveSessionState>(() => {
    const machine = activeSessionSnapshot.sessionId ? stateMachineManager.get(activeSessionSnapshot.sessionId) : null;
    const isProcessing = machine ? machine.getCurrentState() === 'processing' : false;
    const processingPhase = machine ? machine.getContext().processingPhase : null;
    
    return {
      sessionId: activeSessionSnapshot.sessionId,
      isProcessing,
      processingPhase,
      error: activeSessionSnapshot.error,
      status: activeSessionSnapshot.status,
    };
  });

  useEffect(() => {
    const machine = activeSessionSnapshot.sessionId ? stateMachineManager.get(activeSessionSnapshot.sessionId) : null;
    const isProcessing = machine ? machine.getCurrentState() === 'processing' : false;
    const processingPhase = machine ? machine.getContext().processingPhase : null;

    setSessionState(prev => {
      const next: ActiveSessionState = {
        ...activeSessionSnapshot,
        isProcessing,
        processingPhase,
      };

      if (
        prev.sessionId === next.sessionId &&
        prev.isProcessing === next.isProcessing &&
        prev.processingPhase === next.processingPhase &&
        prev.error === next.error &&
        prev.status === next.status
      ) {
        return prev;
      }

      return next;
    });
  }, [activeSessionSnapshot]);

  useEffect(() => {
    // Keep processing fields in sync with the state machine.
    const unsubscribeMachine = stateMachineManager.subscribeGlobal((sessionId, machineSnapshot) => {
      if (sessionState.sessionId === sessionId) {
        const state = machineSnapshot.currentState;
        const isProcessing = state === 'processing';
        const processingPhase = machineSnapshot.context.processingPhase;
        setSessionState(prev => {
          if (prev.isProcessing === isProcessing && prev.processingPhase === processingPhase) return prev;
          return { ...prev, isProcessing, processingPhase };
        });
      }
    });

    return () => {
      unsubscribeMachine();
    };
  }, [sessionState.sessionId]);

  return sessionState;
};

