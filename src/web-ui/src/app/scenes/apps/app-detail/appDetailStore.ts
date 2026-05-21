/**
 * App detail navigation + draft store.
 *
 * Owns: which top-level tab is active, which Agent is being inspected
 * inside the Agents tab, which Section is focused, and any in-flight drafts.
 *
 * Drafts are kept in two namespaces (tools, skills) because those are the only
 * persisted configurable surfaces today. Additional draft namespaces (persona,
 * model, ...) plug in here when their backends land. The DirtyBar reads from
 * the union and saves through whatever handler each draft kind needs.
 */
import { create } from 'zustand';
import type { AppDetailTab, SharedSectionKey } from './types';

interface AppDetailState {
  tab: AppDetailTab;
  agentId: string | null;
  sharedSection: SharedSectionKey;
  toolsDrafts: Record<string, string[]>;
  skillsDrafts: Record<string, string[]>;
  subagentsDrafts: Record<string, string[]>;

  setTab: (tab: AppDetailTab) => void;
  setAgentId: (agentId: string | null) => void;
  setSharedSection: (key: SharedSectionKey) => void;
  setToolsDraft: (agentId: string, tools: string[] | null) => void;
  setSkillsDraft: (agentId: string, skills: string[] | null) => void;
  setSubagentsDraft: (agentId: string, subagents: string[] | null) => void;
  resetForApp: () => void;
}

export const useAppDetailStore = create<AppDetailState>((set) => ({
  tab: 'overview',
  agentId: null,
  sharedSection: 'prompts',
  toolsDrafts: {},
  skillsDrafts: {},
  subagentsDrafts: {},

  setTab: (tab) => set({ tab }),
  setAgentId: (agentId) => set({ agentId }),
  setSharedSection: (sharedSection) => set({ sharedSection }),
  setToolsDraft: (agentId, tools) =>
    set((state) => {
      const next = { ...state.toolsDrafts };
      if (tools === null) delete next[agentId];
      else next[agentId] = tools;
      return { toolsDrafts: next };
    }),
  setSkillsDraft: (agentId, skills) =>
    set((state) => {
      const next = { ...state.skillsDrafts };
      if (skills === null) delete next[agentId];
      else next[agentId] = skills;
      return { skillsDrafts: next };
    }),
  setSubagentsDraft: (agentId, subagents) =>
    set((state) => {
      const next = { ...state.subagentsDrafts };
      if (subagents === null) delete next[agentId];
      else next[agentId] = subagents;
      return { subagentsDrafts: next };
    }),
  resetForApp: () =>
    set({
      tab: 'overview',
      agentId: null,
      sharedSection: 'prompts',
      toolsDrafts: {},
      skillsDrafts: {},
      subagentsDrafts: {},
    }),
}));

