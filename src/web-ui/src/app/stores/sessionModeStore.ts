/**
 * sessionModeStore — tracks the active session creation mode.
 *
 * Session launch modes:
 *   - 'runno'              → Runno task session
 *   - 'bitfun-coder'      → BitFun Coder task session
 *   - 'cowork'            → collaborative Cowork session
 *   - 'design'            → dedicated Design session
 *   - 'deep-research'     → DeepResearch session
 *   - 'agentic-os'        → OSAgent session
 *   - 'app-builder'       → App Builder session
 *   - 'productAppRuntime' → Product App runtime session
 */

import { create } from 'zustand';

export type SessionMode =
  | 'runno'
  | 'bitfun-coder'
  | 'cowork'
  | 'design'
  | 'deep-research'
  | 'agentic-os'
  | 'app-builder'
  | 'productAppRuntime';

interface SessionModeState {
  mode: SessionMode;
  setMode: (mode: SessionMode) => void;
}

export const useSessionModeStore = create<SessionModeState>((set) => ({
  mode: 'runno',
  setMode: (mode) => set({ mode }),
}));
