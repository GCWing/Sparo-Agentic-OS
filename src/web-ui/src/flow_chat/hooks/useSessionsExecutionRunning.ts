/**
 * Tracks which session IDs are in FlowChat "processing" (same as deriveSessionState().isProcessing).
 * Used for live indicators on agent dispatch rows.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { stateMachineManager } from '../state-machine';
import { deriveSessionState } from '../state-machine/derivedState';

function computeProcessingSet(sessionIds: string[]): Set<string> {
  const processing = new Set<string>();
  for (const id of sessionIds) {
    const machine = stateMachineManager.get(id);
    if (machine && deriveSessionState(machine.getSnapshot()).isProcessing) {
      processing.add(id);
    }
  }
  return processing;
}

/**
 * @param sessionIds Session IDs to observe (e.g. dispatcher child sessions).
 * @returns Set of session IDs that are currently running agent work.
 */
export function useSessionsExecutionRunning(sessionIds: string[]): Set<string> {
  const idsRef = useRef(sessionIds);
  idsRef.current = sessionIds;

  const idSignature = useMemo(() => [...sessionIds].sort().join('\u0001'), [sessionIds]);

  const [running, setRunning] = useState<Set<string>>(() =>
    computeProcessingSet(sessionIds)
  );

  useEffect(() => {
    setRunning(computeProcessingSet(idsRef.current));
  }, [idSignature]);

  useEffect(() => {
    const sync = () => setRunning(computeProcessingSet(idsRef.current));
    const unsubMachine = stateMachineManager.subscribeGlobal(sync);
    return () => {
      unsubMachine();
    };
  }, []);

  return running;
}
