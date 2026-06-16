import { create } from 'zustand';

export type SceneId =
  | 'home'
  | 'tasks'
  | 'apps'
  | 'app:skills'
  | 'app:memory'
  | 'app:shell'
  | 'app:settings'
  | 'me'
  | 'search'
  | 'chat';

export interface SessionContext {
  mode: string;
  /** Raw agent_type string from backend, e.g. 'agentic', 'Design', 'Cowork', 'OSAgent' */
  agentType?: string;
  workspacePath?: string;
  workspaceDisplayName?: string;
  sessionId?: string;
  sessionName?: string;
}

const OVERLAY_SCENES: SceneId[] = ['app:skills', 'app:memory', 'app:shell', 'app:settings', 'me', 'search'];

function isOverlay(scene: SceneId): boolean {
  return OVERLAY_SCENES.includes(scene);
}

interface ShellState {
  activeScene: SceneId;
  pageStack: SceneId[];
  sessionContext: SessionContext | null;

  push: (scene: SceneId) => void;
  pop: () => void;
  closeOverlay: () => void;
  openAgenticOs: () => void;
  setSessionContext: (ctx: SessionContext | null) => void;
  openChat: (ctx: SessionContext) => void;
}

export const useShellStore = create<ShellState>((set, get) => ({
  activeScene: 'home',
  pageStack: ['home'],
  sessionContext: null,

  push(scene) {
    set((s) => ({
      activeScene: scene,
      pageStack: [...s.pageStack, scene],
    }));
    history.pushState({ scene }, '');
  },

  pop() {
    const { pageStack } = get();
    if (pageStack.length <= 1) return;
    const next = pageStack[pageStack.length - 2];
    set((s) => ({
      activeScene: next,
      pageStack: s.pageStack.slice(0, -1),
    }));
    history.back();
  },

  closeOverlay() {
    const { activeScene, pageStack } = get();
    if (!isOverlay(activeScene)) return;
    const prev = pageStack.slice().reverse().find((s) => !isOverlay(s)) ?? 'home';
    const newStack = pageStack.filter((s) => !isOverlay(s));
    set({ activeScene: prev as SceneId, pageStack: newStack.length ? newStack : ['home'] });
    history.back();
  },

  openAgenticOs() {
    set({ activeScene: 'home', pageStack: ['home'], sessionContext: null });
    history.pushState({ scene: 'home' }, '');
  },

  setSessionContext(ctx) {
    set({ sessionContext: ctx });
  },

  openChat(ctx) {
    set((s) => ({
      activeScene: 'chat',
      pageStack: [...s.pageStack, 'chat'],
      sessionContext: ctx,
    }));
    history.pushState({ scene: 'chat' }, '');
  },
}));
