/**
 * Agent App detail page types.
 *
 * The detail page is structured around five top-level tabs (Overview / Agents /
 * Shared / Runtime / History). Agents is the configuration core: it lists every
 * top-level Agent of the App ("Agent") on a left nav, and renders a fixed set
 * of configurable Sections per Agent.
 */

export type AppDetailTab = 'overview' | 'agents' | 'shared' | 'runtime' | 'history';

export const APP_DETAIL_TABS: readonly AppDetailTab[] = [
  'overview',
  'agents',
  'shared',
  'runtime',
  'history',
] as const;

export type AgentSectionKey =
  | 'identity'
  | 'persona'
  | 'tools'
  | 'skills'
  | 'subagents'
  | 'model'
  | 'memory'
  | 'guardrails';

export const AGENT_SECTION_KEYS: readonly AgentSectionKey[] = [
  'identity',
  'persona',
  'tools',
  'skills',
  'subagents',
  'model',
  'memory',
  'guardrails',
] as const;

export type SharedSectionKey = 'prompts' | 'files' | 'mcp' | 'model' | 'variables';

export const SHARED_SECTION_KEYS: readonly SharedSectionKey[] = [
  'prompts',
  'files',
  'mcp',
  'model',
  'variables',
] as const;
