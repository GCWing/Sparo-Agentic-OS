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
const InitLiveAppDisplay = lazy(() => import('./InitLiveAppToolDisplay').then(module => ({ default: module.InitLiveAppDisplay })));
const LiveAppStudioToolDisplay = lazy(() => import('./LiveAppStudioToolDisplay').then(module => ({ default: module.LiveAppStudioToolDisplay })));
const AgentAppStudioToolDisplay = lazy(() => import('./AgentAppStudioToolDisplay').then(module => ({ default: module.AgentAppStudioToolDisplay })));
const GenerativeWidgetToolCard = lazy(() => import('./GenerativeWidgetToolCard').then(module => ({ default: module.GenerativeWidgetToolCard })));
const DesignArtifactIndexCard = lazy(() => import('./DesignArtifactIndexCard').then(module => ({ default: module.DesignArtifactIndexCard })));
const DesignTokensProposalCard = lazy(() => import('./DesignTokensProposalCard').then(module => ({ default: module.DesignTokensProposalCard })));
const SessionControlToolCard = lazy(() => import('./SessionControlToolCard').then(module => ({ default: module.SessionControlToolCard })));
const SessionMessageToolCard = lazy(() => import('./SessionMessageToolCard').then(module => ({ default: module.SessionMessageToolCard })));
const SessionHistoryDisplay = lazy(() => import('./SessionHistoryDisplay').then(module => ({ default: module.SessionHistoryDisplay })));
const AgentDispatchCard = lazy(() => import('./AgentDispatchCard').then(module => ({ default: module.AgentDispatchCard })));
const BridgeCallToolCard = lazy(() => import('./BridgeCallToolCard').then(module => ({ default: module.BridgeCallToolCard })));
const WorkToolCard = lazy(() => import('./WorkToolCard').then(module => ({ default: module.WorkToolCard })));

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
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
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
    primaryColor: 'var(--ds-tool-family-agent-app-fg)',
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
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'ContextCompression': {
    toolName: 'ContextCompression',
    displayName: 'Context Compression',
    icon: 'CC',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Compress conversation context to reduce tokens',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
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
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
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
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
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
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
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

  'AgentDispatch': {
    toolName: 'AgentDispatch',
    displayName: 'Agent Dispatch',
    icon: 'AD',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create and manage agent sessions',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-session-fg)',
  },

  'BridgeCall': {
    toolName: 'BridgeCall',
    displayName: 'Bridge Call',
    icon: 'BR',
    requiresConfirmation: true,
    resultDisplayType: 'detailed',
    description: 'Call a Bridge App capability action',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'ListBridgeApps': {
    toolName: 'ListBridgeApps',
    displayName: 'List Bridge Apps',
    icon: 'BAL',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'List installed Bridge Apps',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'GetBridgeApp': {
    toolName: 'GetBridgeApp',
    displayName: 'Inspect Bridge App',
    icon: 'BAG',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Inspect a Bridge App package',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'ValidateBridgeAppPackage': {
    toolName: 'ValidateBridgeAppPackage',
    displayName: 'Validate Bridge App',
    icon: 'BAV',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Validate a Bridge App manifest',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'CreateBridgeApp': {
    toolName: 'CreateBridgeApp',
    displayName: 'Create Bridge App',
    icon: 'BAC',
    requiresConfirmation: true,
    resultDisplayType: 'detailed',
    description: 'Create and register a Bridge App',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'UpdateBridgeApp': {
    toolName: 'UpdateBridgeApp',
    displayName: 'Update Bridge App',
    icon: 'BAU',
    requiresConfirmation: true,
    resultDisplayType: 'detailed',
    description: 'Update an existing Bridge App',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'CreateBridgeAppTemplate': {
    toolName: 'CreateBridgeAppTemplate',
    displayName: 'Bridge Template',
    icon: 'BAT',
    requiresConfirmation: true,
    resultDisplayType: 'detailed',
    description: 'Create a Bridge App template and wrapper',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
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
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },

  'Work': {
    toolName: 'Work',
    displayName: 'Work',
    icon: 'WK',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create, continue, inspect, or control Work',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
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

  // Live App
  'InitLiveApp': {
    toolName: 'InitLiveApp',
    displayName: 'Init Live App',
    icon: 'APP',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create Live App skeleton for editing',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-live-app-fg)'
  },
  'LiveAppRecompile': {
    toolName: 'LiveAppRecompile',
    displayName: 'Recompile Live App',
    icon: 'LAR',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Sync and recompile a Live App preview',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-live-app-fg)'
  },
  'LiveAppRuntimeProbe': {
    toolName: 'LiveAppRuntimeProbe',
    displayName: 'Probe Live App',
    icon: 'LAP',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Read Live App runtime errors and warnings',
    displayMode: 'compact',
    primaryColor: 'var(--ds-status-surface-warning-fg)'
  },
  'LiveAppScreenshotMatrix': {
    toolName: 'LiveAppScreenshotMatrix',
    displayName: 'Live App Matrix',
    icon: 'LAM',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Prepare a visual review matrix for a Live App',
    displayMode: 'compact',
    primaryColor: 'var(--ds-status-surface-info-fg)'
  },

  // Agent App Studio
  'ListAgentApps': {
    toolName: 'ListAgentApps',
    displayName: 'List Agent Apps',
    icon: 'AAL',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'List installed Agent Apps',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'GetAgentApp': {
    toolName: 'GetAgentApp',
    displayName: 'Inspect Agent App',
    icon: 'AAG',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Inspect an Agent App package',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'ValidateAgentAppPackage': {
    toolName: 'ValidateAgentAppPackage',
    displayName: 'Validate Agent App',
    icon: 'AAV',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'Validate an Agent App draft',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'CreateAgentApp': {
    toolName: 'CreateAgentApp',
    displayName: 'Create Agent App',
    icon: 'AAC',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create and register an Agent App',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'UpdateAgentApp': {
    toolName: 'UpdateAgentApp',
    displayName: 'Update Agent App',
    icon: 'AAU',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Update an existing Agent App',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'ListAgentAppToolOptions': {
    toolName: 'ListAgentAppToolOptions',
    displayName: 'Agent App Tool Options',
    icon: 'AAT',
    requiresConfirmation: false,
    resultDisplayType: 'summary',
    description: 'List tools available to Agent Apps',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'CreateAgentAppJsTool': {
    toolName: 'CreateAgentAppJsTool',
    displayName: 'Create Agent App JS Tool',
    icon: 'AAJ',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Create a JS runtime tool inside an Agent App',
    displayMode: 'standard',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
  },
  'TestAgentAppJsTool': {
    toolName: 'TestAgentAppJsTool',
    displayName: 'Test Agent App JS Tool',
    icon: 'AAR',
    requiresConfirmation: false,
    resultDisplayType: 'detailed',
    description: 'Test an Agent App JS runtime tool',
    displayMode: 'compact',
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
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
    primaryColor: 'var(--ds-tool-family-agent-app-fg)'
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
  AgentDispatch: { component: AgentDispatchCard, template: 'custom' },
  BridgeCall: { component: BridgeCallToolCard, template: 'compact', family: 'bridge-app' },
  CreatePlan: { component: CreatePlanDisplay, template: 'custom' },
  TodoWrite: { component: TodoWriteDisplay, template: 'custom' },
  Task: { component: TaskToolDisplay, template: 'custom' },
  submit_code_review: { component: CodeReviewToolCard, template: 'custom' },
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

  // Detail panel family.
  ContextCompression: { component: ContextCompressionDisplay, template: 'detail' },
  GetFileDiff: { component: GetFileDiffDisplay, template: 'detail' },
  InitLiveApp: { component: InitLiveAppDisplay, template: 'detail', family: 'live-app' },
  LiveAppRecompile: { component: LiveAppStudioToolDisplay, template: 'detail', family: 'live-app' },
  LiveAppRuntimeProbe: { component: LiveAppStudioToolDisplay, template: 'detail', family: 'live-app' },
  LiveAppScreenshotMatrix: { component: LiveAppStudioToolDisplay, template: 'custom', family: 'live-app' },
  ListAgentApps: { component: AgentAppStudioToolDisplay, template: 'compact', family: 'agent-app' },
  GetAgentApp: { component: AgentAppStudioToolDisplay, template: 'compact', family: 'agent-app' },
  ValidateAgentAppPackage: { component: AgentAppStudioToolDisplay, template: 'compact', family: 'agent-app' },
  ListAgentAppToolOptions: { component: AgentAppStudioToolDisplay, template: 'compact', family: 'agent-app' },
  TestAgentAppJsTool: { component: AgentAppStudioToolDisplay, template: 'compact', family: 'agent-app' },
  CreateAgentApp: { component: AgentAppStudioToolDisplay, template: 'detail', family: 'agent-app' },
  UpdateAgentApp: { component: AgentAppStudioToolDisplay, template: 'detail', family: 'agent-app' },
  CreateAgentAppJsTool: { component: AgentAppStudioToolDisplay, template: 'detail', family: 'agent-app' },
};

const FAMILY_TOOL_UI_REGISTRY: ToolUiFamilyRegistryEntry[] = [
  {
    id: 'live-app',
    test: (toolName) => toolName.startsWith('LiveApp'),
    entry: { component: LiveAppStudioToolDisplay, template: 'detail', family: 'live-app' },
  },
  {
    id: 'agent-app',
    test: (toolName) => toolName.startsWith('ListAgentApp') || toolName.includes('AgentApp'),
    entry: { component: AgentAppStudioToolDisplay, template: 'detail', family: 'agent-app' },
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
      primaryColor: 'var(--ds-tool-family-agent-app-fg)'
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
