/**
 * agentKinds.ts — canonical Agent kind definitions for the Task Center.
 *
 * Centralizes kind constants, icons, labels, colors, and resolvers so
 * individual components never need to duplicate mode-to-kind logic.
 */

import type { FC, SVGProps } from 'react';
import {
  Brush,
  Code2,
  Cpu,
  LayoutDashboard,
  ListTodo,
  Microscope,
  Zap,
  HelpCircle,
} from 'lucide-react';
import type { Session } from '@/flow_chat/types/flow-chat';

// ── Kind enum ────────────────────────────────────────────────────────────────

export type AgentKind =
  | 'dispatcher'
  | 'liveApp'
  | 'liveAppStudio'
  | 'agentAppStudio'
  | 'deepResearch'
  | 'code'
  | 'cowork'
  | 'design'
  | 'other';

// ── Render order ─────────────────────────────────────────────────────────────

/** Display order for System scope groups. */
export const SYSTEM_GROUP_ORDER: AgentKind[] = [
  'liveApp',
  'liveAppStudio',
  'agentAppStudio',
  'deepResearch',
];

/** Display order for Workspace scope groups. */
export const WORKSPACE_GROUP_ORDER: AgentKind[] = [
  'code',
  'cowork',
  'design',
  'other',
];

// ── Meta per kind ─────────────────────────────────────────────────────────────

type LucideIconComponent = FC<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>;

export interface AgentKindMeta {
  kind: AgentKind;
  /** i18n key suffix: `taskDetailScene.agent.<kind>.label` */
  labelKey: string;
  Icon: LucideIconComponent;
  /** CSS class suffix for icon/badge coloring: `tc-kind--<colorKey>` */
  colorKey: 'accent' | 'emerald' | 'violet' | 'amber' | 'sky' | 'muted';
  /** Whether a "new session" button should appear on the group header. */
  canCreate: boolean;
}

export const AGENT_KIND_META: Record<AgentKind, AgentKindMeta> = {
  dispatcher: {
    kind: 'dispatcher',
    labelKey: 'agent.dispatcher.label',
    Icon: LayoutDashboard as LucideIconComponent,
    colorKey: 'sky',
    canCreate: false,
  },
  liveApp: {
    kind: 'liveApp',
    labelKey: 'agent.liveApp.label',
    Icon: Zap as LucideIconComponent,
    colorKey: 'amber',
    canCreate: true,
  },
  liveAppStudio: {
    kind: 'liveAppStudio',
    labelKey: 'agent.liveAppStudio.label',
    Icon: Zap as LucideIconComponent,
    colorKey: 'amber',
    canCreate: true,
  },
  agentAppStudio: {
    kind: 'agentAppStudio',
    labelKey: 'agent.agentAppStudio.label',
    Icon: Cpu as LucideIconComponent,
    colorKey: 'amber',
    canCreate: true,
  },
  deepResearch: {
    kind: 'deepResearch',
    labelKey: 'agent.deepResearch.label',
    Icon: Microscope as LucideIconComponent,
    colorKey: 'violet',
    canCreate: true,
  },
  code: {
    kind: 'code',
    labelKey: 'agent.code.label',
    Icon: Code2 as LucideIconComponent,
    colorKey: 'accent',
    canCreate: true,
  },
  cowork: {
    kind: 'cowork',
    labelKey: 'agent.cowork.label',
    Icon: ListTodo as LucideIconComponent,
    colorKey: 'emerald',
    canCreate: true,
  },
  design: {
    kind: 'design',
    labelKey: 'agent.design.label',
    Icon: Brush as LucideIconComponent,
    colorKey: 'violet',
    canCreate: true,
  },
  other: {
    kind: 'other',
    labelKey: 'agent.other.label',
    Icon: HelpCircle as LucideIconComponent,
    colorKey: 'muted',
    canCreate: false,
  },
};

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolves the AgentKind for a session based on its mode string.
 * All comparisons are case-insensitive.
 * Defaults to 'code' to match the original behavior (non-dispatcher sessions
 * with an unrecognized or empty mode are treated as code sessions).
 */
export function resolveAgentKind(session: Session): AgentKind {
  const mode = session.mode?.toLowerCase() ?? '';
  switch (mode) {
    case 'dispatcher': return 'dispatcher';
    case 'deepresearch': return 'deepResearch';
    case 'liveappstudio': return 'liveAppStudio';
    case 'agentappstudio': return 'agentAppStudio';
    case 'cowork': return 'cowork';
    case 'design': return 'design';
    case 'code':
    default:
      return 'code';
  }
}
