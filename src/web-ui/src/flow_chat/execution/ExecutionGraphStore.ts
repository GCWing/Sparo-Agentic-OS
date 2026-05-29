import { useSyncExternalStore } from 'react';
import type { AnyFlowItem, FlowThinkingItem, FlowTextItem, FlowToolItem } from '../types/flow-chat';
import type { FlowToolEvent } from '../services/EventBatcher';
import {
  deriveToolRuntimeState,
  isRuntimeTerminalState,
  type ExecutionNodeActivity,
  type ExecutionNodeStatus,
  type RuntimeTerminalState,
  type ToolRuntimeState,
} from '../runtime/statusModel';
import type {
  ExecutionFinalizeStatus,
  ExecutionNode,
  ExecutionNodeIdentity,
  ExecutionSummary,
} from './types';

type Listener = () => void;

const DEFAULT_SUMMARY: ExecutionSummary = {
  status: 'preparing',
  activity: 'idle',
  latestLabel: 'Preparing subagent',
  updatedAt: 0,
};

function buildNodeId(parentSessionId: string, parentToolId: string): string {
  return `${parentSessionId}:${parentToolId}`;
}

function lastNonEmptyMarkdownLine(content: string): string | undefined {
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;

  const heading = [...lines].reverse().find(line => /^#{1,6}\s+/.test(line));
  return heading || lines[lines.length - 1];
}

function summarizeTool(tool: FlowToolItem): ExecutionSummary {
  const runtime = deriveToolRuntimeState(tool);
  const status = executionStatusFromToolLifecycle(runtime.lifecycle);
  const activity = executionActivityFromToolRuntime(tool);
  const input = runtime.partialInput || runtime.input || tool.toolCall?.input || {};
  const filePath = tool._streamingFileStats?.filePath || input.file_path || input.path || input.target_file;
  const latestDetail = typeof filePath === 'string' && filePath.trim() ? filePath.trim() : undefined;
  return {
    status,
    activity,
    latestLabel: status === 'completed'
      ? `${tool.toolName} completed`
      : `${tool.toolName} ${activity === 'receiving_tool_input' ? 'receiving input' : status}`,
    latestDetail,
    latestToolName: tool.toolName,
    updatedAt: Date.now(),
  };
}

function summarizeText(item: FlowTextItem | FlowThinkingItem): ExecutionSummary {
  const line = item.type === 'text' ? lastNonEmptyMarkdownLine(item.content) : undefined;
  const isStreaming = item.isStreaming && item.status !== 'completed' && item.status !== 'cancelled' && item.status !== 'error';
  return {
    status: isStreaming ? 'running' : item.status === 'error' ? 'error' : item.status === 'cancelled' ? 'cancelled' : 'completed',
    activity: isStreaming ? (item.type === 'thinking' ? 'thinking' : 'streaming_text') : 'idle',
    latestLabel: line || (item.type === 'thinking' ? 'Thinking' : 'Streaming response'),
    latestDetail: item.type === 'thinking' ? 'Reasoning in progress' : undefined,
    latestMarkdownLine: line,
    updatedAt: Date.now(),
  };
}

function summarizeNode(node: ExecutionNode): ExecutionSummary {
  const lastItem = node.items[node.items.length - 1];
  if (!lastItem) return node.summary;
  if (lastItem.type === 'tool') return summarizeTool(lastItem as FlowToolItem);
  if (lastItem.type === 'text' || lastItem.type === 'thinking') {
    return summarizeText(lastItem as FlowTextItem | FlowThinkingItem);
  }
  return node.summary;
}

function statusFromToolEvent(event: FlowToolEvent): FlowToolItem['status'] {
  switch (event.event_type) {
    case 'EarlyDetected':
      return 'preparing';
    case 'ParamsPartial':
      return 'streaming';
    case 'Started':
      return 'running';
    case 'Progress':
    case 'Streaming':
    case 'StreamChunk':
      return 'running';
    case 'ConfirmationNeeded':
      return 'pending_confirmation';
    case 'Confirmed':
      return 'confirmed';
    case 'Completed':
      return 'completed';
    case 'Failed':
      return 'error';
    case 'Cancelled':
      return 'cancelled';
    case 'Queued':
    case 'Waiting':
      return 'pending';
    case 'Rejected':
      return 'cancelled';
    default:
      return 'running';
  }
}

function executionStatusFromToolLifecycle(lifecycle: string): ExecutionNodeStatus {
  if (lifecycle === 'completed' || lifecycle === 'cancelled' || lifecycle === 'error') {
    return lifecycle;
  }
  if (lifecycle === 'draining') return 'draining';
  if (lifecycle === 'waiting_confirmation') return 'waiting_confirmation';
  if (lifecycle === 'pending' || lifecycle === 'preparing' || lifecycle === 'ready') return 'preparing';
  return 'running';
}

function executionActivityFromToolRuntime(tool: FlowToolItem): ExecutionNodeActivity {
  const runtime = deriveToolRuntimeState(tool);
  if (isRuntimeTerminalState(runtime.lifecycle)) return 'idle';
  if (runtime.inputPhase === 'streaming') return 'receiving_tool_input';
  if (runtime.lifecycle === 'running') return 'running_tool';
  return 'idle';
}

function isExecutionNodeTerminal(node: ExecutionNode): boolean {
  return node.nodeState ? isRuntimeTerminalState(node.nodeState.status) : isRuntimeTerminalState(node.summary.status);
}

function resolveLiveNodeStatus(
  itemSummary: ExecutionSummary,
  currentNodeState: ExecutionNode['nodeState'] | undefined,
): ExecutionNodeStatus {
  if (currentNodeState?.status === 'draining') {
    return 'draining';
  }

  if (isRuntimeTerminalState(itemSummary.status)) {
    return 'running';
  }

  return itemSummary.status;
}

function mergeToolEvent(existing: FlowToolItem | undefined, event: FlowToolEvent): FlowToolItem {
  const now = Date.now();
  const base: FlowToolItem = existing || {
    id: event.tool_id,
    type: 'tool',
    toolName: event.tool_name,
    toolCall: { input: {}, id: event.tool_id },
    timestamp: now,
    status: 'preparing',
    requiresConfirmation: false,
    startTime: now,
  };

  const next: FlowToolItem = {
    ...base,
    toolName: event.tool_name || base.toolName,
    status: statusFromToolEvent(event),
  };
  const currentRuntime = deriveToolRuntimeState(base);
  const withRuntime = (runtime: Partial<ToolRuntimeState>) => {
    next.runtime = {
      ...currentRuntime,
      ...runtime,
    };
  };

  if (event.event_type === 'ParamsPartial') {
    const buffer = `${next._paramsBuffer || ''}${event.params || ''}`;
    next._paramsBuffer = buffer;
    const partialInput = currentRuntime.partialInput && typeof currentRuntime.partialInput === 'object'
      ? currentRuntime.partialInput
      : {};
    next.toolCall = { input: partialInput, id: event.tool_id };
    withRuntime({
      lifecycle: 'preparing',
      inputPhase: 'streaming',
      partialInput,
    });
  } else if (event.event_type === 'Started') {
    next.toolCall = { input: event.params, id: event.tool_id };
    withRuntime({
      lifecycle: 'running',
      inputPhase: 'parsed',
      input: event.params,
      partialInput: undefined,
      startedAt: next.startTime || now,
    });
    next.startTime = next.startTime || now;
  } else if (event.event_type === 'Progress') {
    (next as any)._progressMessage = event.message;
    (next as any)._progressPercentage = event.percentage;
  } else if (event.event_type === 'ConfirmationNeeded') {
    next.requiresConfirmation = true;
    next.toolCall = { input: event.params, id: event.tool_id };
    withRuntime({
      lifecycle: 'waiting_confirmation',
      inputPhase: 'parsed',
      confirmation: 'required',
      input: event.params,
      partialInput: undefined,
    });
  } else if (event.event_type === 'Completed') {
    next.toolResult = {
      result: event.result,
      success: true,
      resultForAssistant: event.result_for_assistant,
      duration_ms: event.duration_ms,
    };
    withRuntime({
      lifecycle: 'completed',
      inputPhase: currentRuntime.inputPhase === 'streaming' ? 'parsed' : currentRuntime.inputPhase,
      partialInput: undefined,
      result: event.result,
      endedAt: now,
    });
    next.endTime = now;
  } else if (event.event_type === 'Failed') {
    next.toolResult = {
      result: null,
      success: false,
      error: event.error,
    };
    withRuntime({
      lifecycle: 'error',
      inputPhase: currentRuntime.inputPhase === 'streaming' ? 'parsed' : currentRuntime.inputPhase,
      partialInput: undefined,
      result: null,
      error: event.error,
      endedAt: now,
    });
    next.endTime = now;
  } else if (event.event_type === 'Cancelled') {
    next.toolResult = {
      result: null,
      success: false,
      error: event.reason,
    };
    withRuntime({
      lifecycle: 'cancelled',
      inputPhase: currentRuntime.inputPhase === 'streaming' ? 'parsed' : currentRuntime.inputPhase,
      partialInput: undefined,
      result: null,
      error: event.reason,
      endedAt: now,
    });
    next.endTime = now;
  }

  return next;
}

function finalizeSupersededNarrativeItems(
  items: AnyFlowItem[],
  now: number,
  activeItemId?: string,
): AnyFlowItem[] {
  let changed = false;

  const nextItems = items.map(item => {
    if (
      item.id === activeItemId ||
      (item.type !== 'text' && item.type !== 'thinking') ||
      !item.isStreaming ||
      isTerminalStatus(item.status)
    ) {
      return item;
    }

    changed = true;
    if (item.type === 'thinking') {
      return {
        ...item,
        isStreaming: false,
        isCollapsed: true,
        status: 'completed' as const,
        timestamp: item.timestamp || now,
      };
    }

    return {
      ...item,
      isStreaming: false,
      status: 'completed' as const,
      timestamp: item.timestamp || now,
    };
  });

  return changed ? nextItems : items;
}

class ExecutionGraphStore {
  private nodes = new Map<string, ExecutionNode>();
  private listeners = new Set<Listener>();

  getNode(parentSessionId: string | undefined, parentToolId: string | undefined): ExecutionNode | null {
    if (!parentSessionId || !parentToolId) return null;
    return this.nodes.get(buildNodeId(parentSessionId, parentToolId)) || null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  hydrateNode(node: ExecutionNode): ExecutionNode {
    const next = {
      ...node,
      nodeState: node.nodeState ?? {
        status: node.summary.status,
        activity: node.summary.activity ?? 'idle',
      },
    };
    this.nodes.set(node.id, next);
    this.listeners.forEach(listener => listener());
    return next;
  }

  ingestText(identity: ExecutionNodeIdentity, data: {
    roundId: string;
    text: string;
    contentType: string;
    isThinkingEnd?: boolean;
  }): ExecutionNode {
    const node = this.ensureNode(identity);
    if (isExecutionNodeTerminal(node)) {
      return node;
    }
    const isThinking = data.contentType === 'thinking';
    const itemId = `${isThinking ? 'subagent-thinking' : 'subagent-text'}-${identity.parentToolId}-${identity.childSessionId}-${data.roundId}`;
    const existingIndex = node.items.findIndex(item => item.id === itemId);
    const now = Date.now();
    let items = finalizeSupersededNarrativeItems(node.items, now, itemId);

    if (existingIndex >= 0) {
      const existing = items[existingIndex] as FlowTextItem | FlowThinkingItem;
      const updated = {
        ...existing,
        content: existing.content + data.text,
        timestamp: now,
        ...(isThinking && data.isThinkingEnd ? {
          isStreaming: false,
          isCollapsed: true,
          status: 'completed' as const,
        } : {}),
      };
      items = [...items];
      items[existingIndex] = updated;
    } else if (isThinking) {
      const item: FlowThinkingItem = {
        id: itemId,
        type: 'thinking',
        content: data.text,
        timestamp: now,
        isStreaming: !data.isThinkingEnd,
        isCollapsed: !!data.isThinkingEnd,
        status: data.isThinkingEnd ? 'completed' : 'streaming',
      };
      items = [...items, item];
    } else {
      const item: FlowTextItem = {
        id: itemId,
        type: 'text',
        content: data.text,
        timestamp: now,
        isStreaming: true,
        status: 'streaming',
        isMarkdown: true,
      };
      items = [...items, item];
    }

    return this.commitNode({ ...node, items, updatedAt: now });
  }

  ingestToolEvent(identity: ExecutionNodeIdentity, event: FlowToolEvent): ExecutionNode {
    const node = this.ensureNode(identity);
    if (isExecutionNodeTerminal(node)) {
      return node;
    }
    const existingIndex = node.items.findIndex(item => item.type === 'tool' && item.id === event.tool_id);
    const existing = existingIndex >= 0 ? node.items[existingIndex] as FlowToolItem : undefined;
    const updatedTool = mergeToolEvent(existing, event);
    const now = Date.now();
    const items = [...finalizeSupersededNarrativeItems(node.items, now)];

    if (existingIndex >= 0) {
      items[existingIndex] = updatedTool;
    } else {
      items.push(updatedTool);
    }

    return this.commitNode({ ...node, items, updatedAt: now });
  }

  beginNodeDrain(
    identity: ExecutionNodeIdentity,
    status: ExecutionFinalizeStatus,
  ): ExecutionNode {
    const node = this.ensureNode(identity);
    if (isExecutionNodeTerminal(node)) {
      return node;
    }

    const now = Date.now();
    return this.commitNode({
      ...node,
      parentTurnId: identity.parentTurnId ?? node.parentTurnId,
      childSessionId: identity.childSessionId || node.childSessionId,
      summary: {
        ...node.summary,
        status: 'draining',
        activity: 'idle',
        updatedAt: now,
      },
      nodeState: {
        status: 'draining',
        activity: 'idle',
        terminalReason: status,
      },
      updatedAt: now,
    }, {
      status: 'draining',
      activity: 'idle',
    });
  }

  finalizeNodeByParent(
    identity: ExecutionNodeIdentity,
    status: ExecutionFinalizeStatus,
  ): ExecutionNode {
    const node = this.ensureNode(identity);
    const now = Date.now();
    const finalizedItems = node.items.map(item => finalizeItem(item as AnyFlowItem, status, now));
    const shouldUseFinalLabel =
      node.items.length === 0 ||
      !node.summary.latestLabel ||
      node.summary.latestLabel === DEFAULT_SUMMARY.latestLabel;

    return this.commitNode({
      ...node,
      parentTurnId: identity.parentTurnId ?? node.parentTurnId,
      childSessionId: identity.childSessionId || node.childSessionId,
      items: finalizedItems,
      summary: {
        ...node.summary,
        status,
        activity: 'idle',
        latestLabel: shouldUseFinalLabel ? finalStatusLabel(status) : node.summary.latestLabel,
        updatedAt: now,
      },
      nodeState: {
        status,
        activity: 'idle',
        terminalReason: status,
      },
      updatedAt: now,
    }, { status });
  }

  private ensureNode(identity: ExecutionNodeIdentity): ExecutionNode {
    const nodeId = identity.nodeId || buildNodeId(identity.parentSessionId, identity.parentToolId);
    const existing = this.nodes.get(nodeId);
    if (existing) {
      const next = {
        ...existing,
        parentTurnId: identity.parentTurnId ?? existing.parentTurnId,
        childSessionId: identity.childSessionId || existing.childSessionId,
      };
      this.nodes.set(nodeId, next);
      return next;
    }

    const now = Date.now();
    const node: ExecutionNode = {
      id: nodeId,
      kind: 'subagentRun',
      edgeKind: 'delegates',
      parentSessionId: identity.parentSessionId,
      parentTurnId: identity.parentTurnId,
      parentToolId: identity.parentToolId,
      childSessionId: identity.childSessionId,
      items: [],
      summary: { ...DEFAULT_SUMMARY, updatedAt: now },
      nodeState: {
        status: 'preparing',
        activity: 'idle',
      },
      createdAt: now,
      updatedAt: now,
    };
    this.nodes.set(nodeId, node);
    return node;
  }

  private commitNode(node: ExecutionNode, summaryOverride?: Partial<ExecutionSummary>): ExecutionNode {
    const itemSummary = summarizeNode(node);
    const nodeStatus = summaryOverride?.status ?? resolveLiveNodeStatus(itemSummary, node.nodeState);
    const summary = {
      ...itemSummary,
      ...summaryOverride,
      status: nodeStatus,
    };
    const next = {
      ...node,
      summary,
      nodeState: {
        status: nodeStatus,
        activity: summary.activity ?? 'idle',
        terminalReason: node.nodeState?.terminalReason,
        error: node.nodeState?.error,
      },
    };
    this.nodes.set(node.id, next);
    this.listeners.forEach(listener => listener());
    return next;
  }
}

function finalStatusLabel(status: ExecutionFinalizeStatus): string {
  switch (status) {
    case 'completed':
      return 'Subagent completed';
    case 'error':
      return 'Subagent failed';
    case 'cancelled':
      return 'Subagent cancelled';
    default:
      return 'Subagent finished';
  }
}

function finalizeItem(item: AnyFlowItem, status: ExecutionFinalizeStatus, now: number): AnyFlowItem {
  const resolvedStatus = isTerminalStatus(item.status) ? item.status : status;

  if (item.type === 'text') {
    return {
      ...item,
      isStreaming: false,
      status: resolvedStatus,
      timestamp: item.timestamp || now,
    };
  }

  if (item.type === 'thinking') {
    return {
      ...item,
      isStreaming: false,
      isCollapsed: true,
      status: resolvedStatus,
      timestamp: item.timestamp || now,
    };
  }

  if (item.type === 'tool') {
    const runtime = deriveToolRuntimeState(item);
    return {
      ...item,
      runtime: {
        ...runtime,
        lifecycle: resolvedStatus,
        inputPhase: runtime.inputPhase === 'streaming' ? 'parsed' : runtime.inputPhase,
        partialInput: undefined,
        endedAt: item.endTime ?? now,
      },
      status: resolvedStatus,
      endTime: item.endTime ?? now,
    };
  }

  return {
    ...item,
    status: resolvedStatus,
  };
}

function isTerminalStatus(status: unknown): status is RuntimeTerminalState {
  return isRuntimeTerminalState(status);
}

export function createExecutionGraphStore(): ExecutionGraphStore {
  return new ExecutionGraphStore();
}

export const executionGraphStore = createExecutionGraphStore();

export function useSubagentExecution(parentSessionId: string | undefined, parentToolId: string | undefined): ExecutionNode | null {
  return useSyncExternalStore(
    (listener) => executionGraphStore.subscribe(listener),
    () => executionGraphStore.getNode(parentSessionId, parentToolId),
    () => executionGraphStore.getNode(parentSessionId, parentToolId),
  );
}
