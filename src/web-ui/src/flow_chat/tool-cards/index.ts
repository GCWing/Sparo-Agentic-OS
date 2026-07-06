/**
 * Tool card registry.
 * Maps tool configs to components.
 */

import type { ToolCardConfig } from '../types/flow-chat';
import type React from 'react';
import { lazy } from 'react';
import { createLogger } from '@/shared/utils/logger';
import { isMcpToolName, parseMcpToolName } from '@/infrastructure/mcp/toolName';

const log = createLogger('ToolCardRegistry');

/** Provider / stream quirks (e.g. snake_case) — map to TOOL_CARD_CONFIGS keys. */
const TOOL_REGISTRY_ALIASES: Record<string, string> = {
  session_history: 'SessionHistory',
  AgentDispatch: 'AgentHandoff',
  agent_dispatch: 'AgentHandoff',
};

function resolveToolRegistryKey(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return trimmed;
  return TOOL_REGISTRY_ALIASES[trimmed] ?? TOOL_REGISTRY_ALIASES[trimmed.toLowerCase()] ?? trimmed;
}
import { DefaultToolCard } from './DefaultToolCard';

const ReadFileDisplay = lazy(() => import('./ReadFileDisplay').then(module => ({ default: module.ReadFileDisplay })));
const GrepSearchDisplay = lazy(() => import('./GrepSearchDisplay').then(module => ({ default: module.GrepSearchDisplay })));
const GlobSearchDisplay = lazy(() => import('./GlobSearchDisplay').then(module => ({ default: module.GlobSearchDisplay })));
const LSDisplay = lazy(() => import('./LSDisplay').then(module => ({ default: module.LSDisplay })));
const TodoWriteDisplay = lazy(() => import('./TodoWriteDisplay').then(module => ({ default: module.TodoWriteDisplay })));
const CodeReviewToolCard = lazy(() => import('./CodeReviewToolCard').then(module => ({ default: module.CodeReviewToolCard })));
const FileOperationToolCard = lazy(() => import('./FileOperationToolCard').then(module => ({ default: module.FileOperationToolCard })));
const FileOperationPlanToolCard = lazy(() => import('./FileOperationPlanToolCard').then(module => ({ default: module.FileOperationPlanToolCard })));
const WebSearchCard = lazy(() => import('./WebSearchCard').then(module => ({ default: module.WebSearchCard })));
const WebFetchCard = lazy(() => import('./WebFetchCard').then(module => ({ default: module.WebFetchCard })));
const ContextCompressionDisplay = lazy(() => import('./ContextCompressionDisplay').then(module => ({ default: module.ContextCompressionDisplay })));
const MCPToolDisplay = lazy(() => import('./MCPToolDisplay').then(module => ({ default: module.MCPToolDisplay })));
const SkillDisplay = lazy(() => import('./SkillDisplay').then(module => ({ default: module.SkillDisplay })));
const AskUserQuestionCard = lazy(() => import('./AskUserQuestionCard').then(module => ({ default: module.AskUserQuestionCard })));
const GetFileDiffDisplay = lazy(() => import('./GetFileDiffDisplay').then(module => ({ default: module.GetFileDiffDisplay })));
const CreatePlanDisplay = lazy(() => import('./CreatePlanDisplay').then(module => ({ default: module.CreatePlanDisplay })));
const TerminalToolCard = lazy(() => import('./TerminalToolCard').then(module => ({ default: module.TerminalToolCard })));
const TerminalControlDisplay = lazy(() => import('./TerminalControlDisplay').then(module => ({ default: module.TerminalControlDisplay })));
const CreateProductAppDisplay = lazy(() => import('./CreateProductAppToolDisplay').then(module => ({ default: module.CreateProductAppDisplay })));
const ProductAppValidationToolDisplay = lazy(() => import('./ProductAppValidationToolDisplay').then(module => ({ default: module.ProductAppValidationToolDisplay })));
const ProductAppPreviewToolDisplay = lazy(() => import('./ProductAppPreviewToolDisplay').then(module => ({ default: module.ProductAppPreviewToolDisplay })));
const ComponentAuthoringToolDisplay = lazy(() => import('./ComponentAuthoringToolDisplay').then(module => ({ default: module.ComponentAuthoringToolDisplay })));
const GenerativeWidgetToolCard = lazy(() => import('./GenerativeWidgetToolCard').then(module => ({ default: module.GenerativeWidgetToolCard })));
const DesignArtifactIndexCard = lazy(() => import('./DesignArtifactIndexCard').then(module => ({ default: module.DesignArtifactIndexCard })));
const DesignTokensProposalCard = lazy(() => import('./DesignTokensProposalCard').then(module => ({ default: module.DesignTokensProposalCard })));
const SessionControlToolCard = lazy(() => import('./SessionControlToolCard').then(module => ({ default: module.SessionControlToolCard })));
const SessionMessageToolCard = lazy(() => import('./SessionMessageToolCard').then(module => ({ default: module.SessionMessageToolCard })));
const SessionHistoryDisplay = lazy(() => import('./SessionHistoryDisplay').then(module => ({ default: module.SessionHistoryDisplay })));
const AgentHandoffCard = lazy(() => import('./AgentHandoffCard').then(module => ({ default: module.AgentHandoffCard })));
const BridgeComponentCallToolCard = lazy(() => import('./BridgeComponentCallToolCard').then(module => ({ default: module.BridgeComponentCallToolCard })));
const WorkToolCard = lazy(() => import('./WorkToolCard').then(module => ({ default: module.WorkToolCard })));
const OutcomeReviewToolCard = lazy(() => import('./OutcomeReviewToolCard').then(module => ({ default: module.OutcomeReviewToolCard })));
const MemoryToolCard = lazy(() => import('./MemoryToolCard').then(module => ({ default: module.MemoryToolCard })));
const GoalToolCard = lazy(() => import('./GoalToolCard').then(module => ({ default: module.GoalToolCard })));

const TaskToolDisplay = lazy(() =>
  import('./TaskToolDisplay').then(module => ({ default: module.TaskToolDisplay })),
);

export type ToolUiTemplateKind = 'compact' | 'detail' | 'previewStream' | 'custom';

export interface ToolUiRegistryEntry {
  component?: React.ComponentType<any>;
  template: ToolUiTemplateKind;
  family?: string;
}

export interface ToolUiFamilyRegistryEntry {
  id: string;
  test: (toolName: string) => boolean;
  entry: ToolUiRegistryEntry;
}

// Tool card config map - uses backend tool names
export const TOOL_CARD_CONFIGS: Record<string, ToolCardConfig> = {
  // File tools
  'Read': {
    toolName: 'Read',
    displayName: 'Read File',
    icon: 'R',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Read file contents',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-explore-fg)'
  },
  'Write': {
    toolName: 'Write',
    displayName: 'Write File',
    icon: 'W',
    requiresConfirmation: false, // Snapshot system handles confirmation.
    resultDisplayType: 'summary',
    description: 'Write or create a file',
    displayMode: 'standard',
    primaryColor: 'var(--ds-status-surface-success-fg)',
    inlineInterruptionNote: true,
  },
  'Edit': {
    toolName: 'Edit',
    displayName: 'Edit File',
    icon: 'E',
    requiresConfirmation: false, // Snapshot system handles confirmation.
    resultDisplayType: 'detailed',
    description: 'Edit file contents',
    displayMode: 'standard',
    primaryColor: 'var(--ds-status-surface-warning-fg)',
    inlineInterruptionNote: true,
  },
  'Delete': {
    toolName: 'Delete',
    displayName: 'Delete File',
    icon: 'D',
    requiresConfirmation: false, // Snapshot system handles confirmation.
    resultDisplayType: 'summary',
    description: 'Delete a file',
    displayMode: 'detailed',
    primaryColor: 'var(--ds-status-surface-danger-fg)',
    inlineInterruptionNote: true,
  },
  'FileOperationPlan': {
    toolName: 'FileOperationPlan',
    displayName: 'File Operation Plan',
    icon: 'FOP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create a preview-only file operation plan',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-explore-fg)'
  },
  'LS': {
    toolName: 'LS',
    displayName: 'List Directory',
    icon: 'L',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'List directory contents',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-session-fg)'
  },

  // Search tools
  'Grep': {
    toolName: 'Grep',
    displayName: 'Text Search',
    icon: 'G',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Search text in files',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'Glob': {
    toolName: 'Glob',
    displayName: 'File Search',
    icon: 'F',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Search files by pattern',
    displayMode: 'compact',
    primaryColor: 'var(--ds-status-surface-info-fg)'
  },

  // Web tools
  'WebSearch': {
    toolName: 'WebSearch',
    displayName: 'Web Search',
    icon: 'WS',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Search the web',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-explore-fg)'
  },
  'WebFetch': {
    toolName: 'WebFetch',
    displayName: 'Fetch Link',
    icon: 'WF',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Fetch webpage content',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-explore-fg)'
  },

  // Advanced tools
  'Task': {
    toolName: 'Task',
    displayName: 'Run Task',
    icon: '',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Run a specialized AI task',
    displayMode: 'detailed',
    primaryColor: 'var(--ds-tool-family-agent-fg)',
    inlineInterruptionNote: true,
  },
  'TodoWrite': {
    toolName: 'TodoWrite',
    displayName: 'Task Manager',
    icon: 'T',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Manage task lists',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-planning-fg)'
  },
  'submit_code_review': {
    toolName: 'submit_code_review',
    displayName: 'Code Review',
    icon: 'CR',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Submit code review results',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'submit_outcome_review': {
    toolName: 'submit_outcome_review',
    displayName: 'Outcome Review',
    icon: 'OR',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Submit an evidence-backed outcome review verdict',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'ContextCompression': {
    toolName: 'ContextCompression',
    displayName: 'Context Compression',
    icon: 'CC',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Compress conversation context to reduce tokens',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },

  // Skill tool
  'Skill': {
    toolName: 'Skill',
    displayName: 'Skill',
    icon: 'S',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Load and run skills',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },

  'Memory': {
    toolName: 'Memory',
    displayName: 'Memory',
    icon: 'MEM',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Save durable memory',
    displayMode: 'compact',
    primaryColor: 'var(--ds-status-surface-info-fg)'
  },

  // AskUserQuestion tool
  'AskUserQuestion': {
    toolName: 'AskUserQuestion',
    displayName: 'Ask User',
    icon: 'Q',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Ask the user a question and wait for a reply',
    displayMode: 'detailed',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },

  // GetFileDiff tool
  'GetFileDiff': {
    toolName: 'GetFileDiff',
    displayName: 'File Diff',
    icon: 'DIFF',
    requiresConfirmation: false, // Read-only tool.
    resultDisplayType: 'detailed',
    description: 'Get file diffs (baseline snapshot or full file)',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },

  // CreatePlan tool
  'CreatePlan': {
    toolName: 'CreatePlan',
    displayName: 'Create Plan',
    icon: 'PLAN',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create and manage project plans',
    displayMode: 'detailed',
    primaryColor: 'var(--ds-status-surface-warning-fg)'
  },

  // TerminalControl tool
  'TerminalControl': {
    toolName: 'TerminalControl',
    displayName: 'Terminal Control',
    icon: 'TC',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Kill or interrupt a terminal session',
    displayMode: 'compact',
    primaryColor: 'var(--ds-status-surface-danger-fg)'
  },

  'AgentHandoff': {
    toolName: 'AgentHandoff',
    displayName: 'Agent Handoff',
    icon: 'AH',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create and manage agent sessions',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-session-fg)',
  },

  'BridgeComponentCall': {
    toolName: 'BridgeComponentCall',
    displayName: 'Bridge Call',
    icon: 'BR',
    requiresConfirmation: true,
    resultDisplayType: 'detailed',
    description: 'Call a Bridge Component capability action',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'ListBridgeComponents': {
    toolName: 'ListBridgeComponents',
    displayName: 'List Bridge Components',
    icon: 'BAL',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'List installed Bridge Components',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'GetBridgeComponent': {
    toolName: 'GetBridgeComponent',
    displayName: 'Inspect Bridge Component',
    icon: 'BAG',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Inspect a Bridge Component package',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'ValidateBridgeComponentPackage': {
    toolName: 'ValidateBridgeComponentPackage',
    displayName: 'Validate Bridge Component',
    icon: 'BAV',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Validate a Bridge Component manifest',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'CreateBridgeComponent': {
    toolName: 'CreateBridgeComponent',
    displayName: 'Create Bridge Component',
    icon: 'BAC',
    requiresConfirmation: true,
    resultDisplayType: 'detailed',
    description: 'Create and register a Bridge Component',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'UpdateBridgeComponent': {
    toolName: 'UpdateBridgeComponent',
    displayName: 'Update Bridge Component',
    icon: 'BAU',
    requiresConfirmation: true,
    resultDisplayType: 'detailed',
    description: 'Update an existing Bridge Component',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'CreateBridgeComponentTemplate': {
    toolName: 'CreateBridgeComponentTemplate',
    displayName: 'Bridge Template',
    icon: 'BAT',
    requiresConfirmation: true,
    resultDisplayType: 'detailed',
    description: 'Create a Bridge Component template and wrapper',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },

  'SessionControl': {
    toolName: 'SessionControl',
    displayName: 'Session Control',
    icon: 'SC',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Create, delete, or list sessions',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-explore-fg)'
  },

  'SessionMessage': {
    toolName: 'SessionMessage',
    displayName: 'Session Message',
    icon: 'SM',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Send a message to another session',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },

  'Work': {
    toolName: 'Work',
    displayName: 'Work',
    icon: 'WK',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create, continue, inspect, or control Work',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },

  'Goal': {
    toolName: 'Goal',
    displayName: 'Goal',
    icon: 'GL',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Report goal progress, evidence, blockers, or a completion claim',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-planning-fg)'
  },

  'SessionHistory': {
    toolName: 'SessionHistory',
    displayName: 'Read session history',
    icon: 'SH',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Export and read another session transcript',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-explore-fg)'
  },

  // Bash terminal tool
  'Bash': {
    toolName: 'Bash',
    displayName: 'Run Command',
    icon: 'TERM',
    requiresConfirmation: true, // Requires user confirmation.
    resultDisplayType: 'detailed',
    description: 'Run commands in the terminal',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-terminal-fg)'
  },

  // Product App surface runtime
  'CreateProductApp': {
    toolName: 'CreateProductApp',
    displayName: 'Init Product App',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create Product App surface skeleton for editing',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-browser-fg)'
  },
  'CreateProductAppComponent': {
    toolName: 'CreateProductAppComponent',
    displayName: 'Create Product App Component',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create an app-private Product App component scaffold',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-browser-fg)'
  },
  'GetProductAppPackage': {
    toolName: 'GetProductAppPackage',
    displayName: 'Read Product App Package',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Read Product App package, component graph, plans, and lock status',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-browser-fg)'
  },
  'UpdateProductAppPackage': {
    toolName: 'UpdateProductAppPackage',
    displayName: 'Update Product App Package',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Update Product App package metadata, launch, surface, and lock state',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-browser-fg)'
  },
  'RefreshProductAppLock': {
    toolName: 'RefreshProductAppLock',
    displayName: 'Refresh Product App Lock',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Resolve Product App components and rewrite app.json/app.lock.json lock state',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-browser-fg)'
  },
  'ResolveBuilderPreviewTarget': {
    toolName: 'ResolveBuilderPreviewTarget',
    displayName: 'Resolve Builder Preview Target',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Resolve Product App preview identity, mode, placement, and evidence boundary',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-browser-fg)'
  },
  'ValidateProductAppPackage': {
    toolName: 'ValidateProductAppPackage',
    displayName: 'Validate Product App',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Validate Product App package, lock, permissions, and component graph',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-browser-fg)'
  },
  'CreateProductAppCheckpoint': {
    toolName: 'CreateProductAppCheckpoint',
    displayName: 'Create App Checkpoint',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create a stable Product App package checkpoint',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-browser-fg)'
  },
  'CompareProductAppRevisions': {
    toolName: 'CompareProductAppRevisions',
    displayName: 'Compare App Revisions',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Compare Product App checkpoint revisions',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-browser-fg)'
  },
  'CreateProductAppFromReleaseTemplate': {
    toolName: 'CreateProductAppFromReleaseTemplate',
    displayName: 'Create App From Release',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create a new Product App package from a release snapshot',
    displayMode: 'standard',
    primaryColor: 'var(--ds-status-surface-success-fg)'
  },
  'RestoreProductAppCheckpoint': {
    toolName: 'RestoreProductAppCheckpoint',
    displayName: 'Restore App Checkpoint',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Restore a Product App package from a checkpoint',
    displayMode: 'standard',
    primaryColor: 'var(--ds-status-surface-warning-fg)'
  },
  'RestoreProductAppRelease': {
    toolName: 'RestoreProductAppRelease',
    displayName: 'Restore App Release',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Roll back a Product App package to a release source snapshot',
    displayMode: 'standard',
    primaryColor: 'var(--ds-status-surface-warning-fg)'
  },
  'CreateProductAppRelease': {
    toolName: 'CreateProductAppRelease',
    displayName: 'Create App Release',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create a Product App release artifact from passed release readiness',
    displayMode: 'standard',
    primaryColor: 'var(--ds-status-surface-success-fg)'
  },
  'PublishProductAppRelease': {
    toolName: 'PublishProductAppRelease',
    displayName: 'Publish App Release',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Publish a Product App release artifact into the local catalog source',
    displayMode: 'standard',
    primaryColor: 'var(--ds-status-surface-success-fg)'
  },
  'RunBuilderPreview': {
    toolName: 'RunBuilderPreview',
    displayName: 'Run Builder Preview',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Run the App Builder Preview Harness and record preview evidence',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-browser-fg)'
  },
  'ValidateComponentPackage': {
    toolName: 'ValidateComponentPackage',
    displayName: 'Validate Component Package',
    icon: 'CMP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Validate Component package contract, permissions, and consumer gates',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },

  // Component authoring tools
  'CreateComponentPackage': {
    toolName: 'CreateComponentPackage',
    displayName: 'Create Component Package',
    icon: 'CMP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create a reusable Component Package',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'ListAgentComponents': {
    toolName: 'ListAgentComponents',
    displayName: 'List Agent Components',
    icon: 'AAL',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'List installed Agent Components',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'GetAgentComponent': {
    toolName: 'GetAgentComponent',
    displayName: 'Inspect Agent Component',
    icon: 'AAG',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Inspect an Agent Component package',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'ValidateAgentComponentPackage': {
    toolName: 'ValidateAgentComponentPackage',
    displayName: 'Validate Agent Component',
    icon: 'AAV',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Validate an Agent Component draft',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'CreateAgentComponent': {
    toolName: 'CreateAgentComponent',
    displayName: 'Create Agent Component',
    icon: 'AAC',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create and register an Agent Component',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'UpdateAgentComponent': {
    toolName: 'UpdateAgentComponent',
    displayName: 'Update Agent Component',
    icon: 'AAU',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Update an existing Agent Component',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'ListAgentComponentToolOptions': {
    toolName: 'ListAgentComponentToolOptions',
    displayName: 'Agent Component Tool Options',
    icon: 'AAT',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'List tools available to Agent Components',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'CreateAgentComponentJsTool': {
    toolName: 'CreateAgentComponentJsTool',
    displayName: 'Create Agent Component JS Tool',
    icon: 'AAJ',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create a JS runtime tool inside an Agent Component',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'TestAgentComponentJsTool': {
    toolName: 'TestAgentComponentJsTool',
    displayName: 'Test Agent Component JS Tool',
    icon: 'AAR',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Test an Agent Component JS runtime tool',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'GenerativeUI': {
    toolName: 'GenerativeUI',
    displayName: 'Generative UI',
    icon: 'UI',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Render interactive widget previews inline in FlowChat',
    displayMode: 'detailed',
    primaryColor: 'var(--ds-status-surface-info-fg)'
  },
  'DesignArtifact': {
    toolName: 'DesignArtifact',
    displayName: 'Design Artifact',
    icon: 'DA',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Create and evolve design artifacts in the Design Canvas tab',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-fg)'
  },
  'DesignTokens': {
    toolName: 'DesignTokens',
    displayName: 'Design Tokens',
    icon: 'DT',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Propose and commit design token palettes',
    displayMode: 'detailed',
    primaryColor: 'var(--ds-status-surface-info-fg)'
  },
};

const EXACT_TOOL_UI_REGISTRY: Record<string, ToolUiRegistryEntry> = {
  // Highly custom renderers: preserve product-specific interactions.
  AskUserQuestion: { component: AskUserQuestionCard, template: 'custom' },
  AgentHandoff: { component: AgentHandoffCard, template: 'custom' },
  BridgeComponentCall: { component: BridgeComponentCallToolCard, template: 'compact', family: 'bridge-component' },
  CreatePlan: { component: CreatePlanDisplay, template: 'custom' },
  TodoWrite: { component: TodoWriteDisplay, template: 'custom' },
  Task: { component: TaskToolDisplay, template: 'custom' },
  submit_code_review: { component: CodeReviewToolCard, template: 'custom' },
  submit_outcome_review: { component: OutcomeReviewToolCard, template: 'custom', family: 'work' },
  GenerativeUI: { component: GenerativeWidgetToolCard, template: 'custom' },
  DesignArtifact: { component: DesignArtifactIndexCard, template: 'custom' },
  DesignTokens: { component: DesignTokensProposalCard, template: 'custom' },

  // Preview/stream family: shared lifecycle shape, specialized body renderers.
  Write: { component: FileOperationToolCard, template: 'previewStream', family: 'file-operation' },
  Edit: { component: FileOperationToolCard, template: 'previewStream', family: 'file-operation' },
  Delete: { component: FileOperationToolCard, template: 'previewStream', family: 'file-operation' },
  FileOperationPlan: { component: FileOperationPlanToolCard, template: 'custom', family: 'file-operation' },
  Bash: { component: TerminalToolCard, template: 'previewStream', family: 'process' },

  // Compact row family.
  Read: { component: ReadFileDisplay, template: 'compact', family: 'explore' },
  LS: { component: LSDisplay, template: 'compact', family: 'explore' },
  Grep: { component: GrepSearchDisplay, template: 'compact', family: 'explore' },
  Glob: { component: GlobSearchDisplay, template: 'compact', family: 'explore' },
  WebSearch: { component: WebSearchCard, template: 'compact', family: 'explore' },
  WebFetch: { component: WebFetchCard, template: 'compact', family: 'explore' },
  Skill: { component: SkillDisplay, template: 'compact' },
  TerminalControl: { component: TerminalControlDisplay, template: 'compact' },
  SessionHistory: { component: SessionHistoryDisplay, template: 'compact' },
  SessionControl: { component: SessionControlToolCard, template: 'compact', family: 'session' },
  SessionMessage: { component: SessionMessageToolCard, template: 'compact', family: 'session' },
  Work: { component: WorkToolCard, template: 'compact', family: 'work' },
  Goal: { component: GoalToolCard, template: 'compact', family: 'goal' },
  Memory: { component: MemoryToolCard, template: 'compact', family: 'memory' },

  // Detail panel family.
  ContextCompression: { component: ContextCompressionDisplay, template: 'detail' },
  GetFileDiff: { component: GetFileDiffDisplay, template: 'detail' },
  CreateProductApp: { component: CreateProductAppDisplay, template: 'detail', family: 'product-app' },
  CreateProductAppComponent: { component: DefaultToolCard, template: 'detail', family: 'product-app' },
  GetProductAppPackage: { component: DefaultToolCard, template: 'detail', family: 'product-app' },
  UpdateProductAppPackage: { component: DefaultToolCard, template: 'detail', family: 'product-app' },
  RefreshProductAppLock: { component: DefaultToolCard, template: 'detail', family: 'product-app' },
  ResolveBuilderPreviewTarget: { component: DefaultToolCard, template: 'detail', family: 'product-app' },
  CreateProductAppCheckpoint: { component: DefaultToolCard, template: 'detail', family: 'product-app' },
  CompareProductAppRevisions: { component: DefaultToolCard, template: 'detail', family: 'product-app' },
  CreateProductAppFromReleaseTemplate: { component: DefaultToolCard, template: 'detail', family: 'product-app' },
  RestoreProductAppCheckpoint: { component: DefaultToolCard, template: 'detail', family: 'product-app' },
  RestoreProductAppRelease: { component: DefaultToolCard, template: 'detail', family: 'product-app' },
  CreateProductAppRelease: { component: DefaultToolCard, template: 'detail', family: 'product-app' },
  PublishProductAppRelease: { component: DefaultToolCard, template: 'detail', family: 'product-app' },
  ValidateProductAppPackage: { component: ProductAppValidationToolDisplay, template: 'detail', family: 'product-app' },
  RunBuilderPreview: { component: ProductAppPreviewToolDisplay, template: 'detail', family: 'product-app' },
  ValidateComponentPackage: { component: ProductAppValidationToolDisplay, template: 'detail', family: 'component' },
  CreateComponentPackage: { component: ComponentAuthoringToolDisplay, template: 'detail', family: 'component' },
  ListAgentComponents: { component: ComponentAuthoringToolDisplay, template: 'compact', family: 'component' },
  GetAgentComponent: { component: ComponentAuthoringToolDisplay, template: 'compact', family: 'component' },
  ValidateAgentComponentPackage: { component: ComponentAuthoringToolDisplay, template: 'compact', family: 'component' },
  ListAgentComponentToolOptions: { component: ComponentAuthoringToolDisplay, template: 'compact', family: 'component' },
  TestAgentComponentJsTool: { component: ComponentAuthoringToolDisplay, template: 'compact', family: 'component' },
  CreateAgentComponent: { component: ComponentAuthoringToolDisplay, template: 'detail', family: 'component' },
  UpdateAgentComponent: { component: ComponentAuthoringToolDisplay, template: 'detail', family: 'component' },
  CreateAgentComponentJsTool: { component: ComponentAuthoringToolDisplay, template: 'detail', family: 'component' },
};

const FAMILY_TOOL_UI_REGISTRY: ToolUiFamilyRegistryEntry[] = [
  {
    id: 'component',
    test: (toolName) => toolName.includes('AgentComponent') || toolName.includes('BridgeComponent'),
    entry: { component: ComponentAuthoringToolDisplay, template: 'detail', family: 'component' },
  },
];

const dynamicExactToolUiRegistry = new Map<string, ToolUiRegistryEntry>();
const dynamicFamilyToolUiRegistry: ToolUiFamilyRegistryEntry[] = [];
const dynamicToolCardConfigs = new Map<string, ToolCardConfig>();

export function registerToolUiRenderer(toolName: string, entry: ToolUiRegistryEntry): () => void {
  const key = resolveToolRegistryKey(toolName);
  dynamicExactToolUiRegistry.set(key, entry);
  return () => {
    if (dynamicExactToolUiRegistry.get(key) === entry) {
      dynamicExactToolUiRegistry.delete(key);
    }
  };
}

export function unregisterToolUiRenderer(toolName: string): void {
  dynamicExactToolUiRegistry.delete(resolveToolRegistryKey(toolName));
}

export function registerToolUiFamily(entry: ToolUiFamilyRegistryEntry): () => void {
  dynamicFamilyToolUiRegistry.unshift(entry);
  return () => {
    const index = dynamicFamilyToolUiRegistry.findIndex((candidate) => candidate.id === entry.id);
    if (index >= 0) {
      dynamicFamilyToolUiRegistry.splice(index, 1);
    }
  };
}

export function unregisterToolUiFamily(id: string): void {
  const index = dynamicFamilyToolUiRegistry.findIndex((candidate) => candidate.id === id);
  if (index >= 0) {
    dynamicFamilyToolUiRegistry.splice(index, 1);
  }
}

export function registerToolCardConfig(toolName: string, config: ToolCardConfig): () => void {
  const key = resolveToolRegistryKey(toolName);
  dynamicToolCardConfigs.set(key, config);
  return () => {
    if (dynamicToolCardConfigs.get(key) === config) {
      dynamicToolCardConfigs.delete(key);
    }
  };
}

export function unregisterToolCardConfig(toolName: string): void {
  dynamicToolCardConfigs.delete(resolveToolRegistryKey(toolName));
}

export function getToolUiRegistryEntry(toolName: string): ToolUiRegistryEntry {
  const raw = (toolName ?? '').trim();
  const key = resolveToolRegistryKey(raw);
  const dynamicExact = dynamicExactToolUiRegistry.get(key);
  if (dynamicExact) {
    return dynamicExact;
  }

  const exact = EXACT_TOOL_UI_REGISTRY[key];
  if (exact) {
    return exact;
  }

  const family = [...dynamicFamilyToolUiRegistry, ...FAMILY_TOOL_UI_REGISTRY].find((candidate) => candidate.test(key));
  if (family) {
    return family.entry;
  }

  if (isMcpToolName(raw)) {
    return { component: MCPToolDisplay, template: 'custom', family: 'mcp' };
  }

  return { component: DefaultToolCard, template: 'detail', family: 'fallback' };
}

/**
 * Get tool card config.
 */
export function getToolCardConfig(toolName: string): ToolCardConfig {
  const raw = (toolName ?? '').trim();
  // Check MCP tools (prefix: mcp__).
  if (isMcpToolName(raw)) {
    const parsed = parseMcpToolName(raw);
    const actualToolName = parsed?.toolName ?? raw;

    return {
      toolName: raw,
      displayName: actualToolName || raw,
      icon: 'MCP',
      requiresConfirmation: false,
      resultDisplayType: 'detailed',
      description: 'MCP',
      displayMode: 'compact',
      primaryColor: 'var(--ds-tool-family-agent-fg)'
    };
  }

  const key = resolveToolRegistryKey(raw);
  const dynamicConfig = dynamicToolCardConfigs.get(key);
  if (dynamicConfig) {
    return dynamicConfig;
  }

  // Match by name or fall back to defaults.
  return TOOL_CARD_CONFIGS[key] || {
    toolName: raw,
    displayName: `Tool: ${raw}`,
    icon: 'TOOL',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: `Run ${raw} tool`,
    displayMode: 'standard',
    primaryColor: 'var(--ds-status-surface-neutral-fg)'
  };
}

/**
 * Get tool card component.
 */
export function getToolCardComponent(toolName: string) {
  const raw = (toolName ?? '').trim();
  const key = resolveToolRegistryKey(raw);
  const component = getToolUiRegistryEntry(key).component;
  
  // Debug log (only when a component is missing).
  if (!component) {
    log.warn('Tool card component not found, using default', { toolName: raw, resolvedKey: key });
  }
  
  return component || DefaultToolCard;
}

/**
 * Check whether a tool needs confirmation.
 */
export function requiresConfirmation(toolName: string): boolean {
  const config = getToolCardConfig(toolName);
  return config.requiresConfirmation;
}

/**
 * Get all registered tool names.
 */
export function getAllToolNames(): string[] {
  return Array.from(new Set([...Object.keys(TOOL_CARD_CONFIGS), ...dynamicToolCardConfigs.keys()]));
}

// Export components
export {
  BaseToolCard,
  ToolCardHeader,
} from './BaseToolCard';
export {
  ToolCardHeaderLayoutContext,
  useToolCardHeaderLayout,
} from './ToolCardHeaderLayoutContext';
export type {
  BaseToolCardProps,
  ToolCardHeaderProps,
} from './BaseToolCard';
export type {
  ToolCardHeaderLayoutContextValue,
  ToolCardHeaderAffordanceKind,
} from './ToolCardHeaderLayoutContext';
export { PlanDisplay } from './CreatePlanDisplay';
export type { PlanDisplayProps } from './CreatePlanDisplay';
export { ToolCardStatusSlot } from './ToolCardStatusSlot';
export type { ToolCardStatusSlotProps, ToolCardStatusSlotStatus } from './ToolCardStatusSlot';
export { ToolStatusIndicator } from './ToolStatusIndicator';
export type { ToolStatusIndicatorProps } from './ToolStatusIndicator';
export { isToolStatusLoading, isToolStatusTerminal } from './toolStatus';
export type { ToolCardStatus } from './toolStatus';
export { ToolHeaderLayout, ToolCompactHeaderLayout } from './ToolHeaderLayout';
export type { ToolHeaderLayoutProps, ToolCompactHeaderLayoutProps } from './ToolHeaderLayout';
export { useToolDisclosureController } from './ToolDisclosureController';
export type { ToolDisclosureControllerOptions } from './ToolDisclosureController';
export { ToolActionGroup } from './ToolActionGroup';
export type { ToolActionGroupProps } from './ToolActionGroup';
export { ToolErrorBlock } from './ToolErrorBlock';
export type { ToolErrorBlockProps } from './ToolErrorBlock';
export { ToolStructuredDetails } from './ToolStructuredDetails';
export type { ToolDetailRow, ToolStructuredDetailsProps } from './ToolStructuredDetails';
export { ToolJsonPreview } from './ToolJsonPreview';
export type { ToolJsonPreviewProps } from './ToolJsonPreview';
export { ToolRightRail, ToolExternalRailIcon } from './ToolRightRail';
export type { ToolRightRailProps } from './ToolRightRail';
export { ToolPreviewFrame } from './ToolPreviewFrame';
export type { ToolPreviewFrameProps } from './ToolPreviewFrame';
export { ToolArtifactFrame } from './ToolArtifactFrame';
export type { ToolArtifactFrameProps } from './ToolArtifactFrame';
export {
  DefaultToolCardTemplate,
  DetailToolTemplate,
  HeavyToolCardTemplate,
  PreviewStreamToolTemplate,
  renderHeavyToolRunningStatus,
} from './templates';
export type {
  DefaultToolCardPrimaryAction,
  DefaultToolCardTemplateProps,
  DetailToolTemplateProps,
  HeavyToolCardTemplateProps,
  PreviewStreamToolTemplateProps,
} from './templates';
export {
  COLLAPSIBLE_TOOL_NAMES,
  READ_TOOL_NAMES,
  SEARCH_TOOL_NAMES,
  COMMAND_TOOL_NAMES,
  isCollapsibleTool,
  isCollapsibleItem,
  isCollapsibleItemWithContext,
} from './collapsibleTools';
