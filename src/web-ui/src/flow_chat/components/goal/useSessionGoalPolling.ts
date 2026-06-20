import { useEffect } from 'react';
import { useSessionGoalStore } from '@/flow_chat/store/sessionGoalStore';

export function useSessionGoalPolling({
  enabled,
  sessionId,
  workspacePath,
  intervalMs = 3000,
}: {
  enabled: boolean;
  sessionId?: string | null;
  workspacePath?: string | null;
  intervalMs?: number;
}): void {
  useEffect(() => {
    if (!enabled || !sessionId || !workspacePath) return undefined;

    const refresh = () => {
      void useSessionGoalStore.getState().refreshSessionGoal(sessionId, workspacePath);
    };
    refresh();

    const handle = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(handle);
  }, [enabled, intervalMs, sessionId, workspacePath]);
}
