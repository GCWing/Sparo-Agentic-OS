/**
 * Routes parent-routed subagent events into the execution graph.
 *
 * Subagent output must not be flattened into the parent model round. The
 * parent Task card owns only a lightweight summary projection; full child
 * output is rendered by execution detail/inline projections on demand.
 */

import { createLogger } from '@/shared/utils/logger';
import { executionGraphStore } from '../../execution';
import type { ExecutionFinalizeStatus, ExecutionNode } from '../../execution';
import type { FlowChatContext, SubagentTextChunkData, SubagentToolEventData } from './types';
import type { ToolEventData } from '../EventBatcher';
import { debouncedSaveDialogTurn } from './PersistenceModule';

const log = createLogger('SubagentModule');
const SUBAGENT_COMPLETION_QUIET_WINDOW_MS = 500;

interface PendingSubagentFinalization {
  context: FlowChatContext;
  identity: {
    nodeId: string;
    parentSessionId: string;
    parentTurnId?: string;
    parentToolId: string;
    childSessionId: string;
  };
  status: ExecutionFinalizeStatus;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
}

const pendingSubagentFinalizations = new Map<string, PendingSubagentFinalization>();

function buildNodeId(parentSessionId: string, parentToolId: string): string {
  return `${parentSessionId}:${parentToolId}`;
}

function resolveParentTurnId(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  explicitTurnId?: string,
): string | undefined {
  if (explicitTurnId) {
    return explicitTurnId;
  }

  const parentSession = context.flowChatStore.getState().sessions.get(parentSessionId);
  if (!parentSession) {
    log.debug('Parent session not found for subagent event', { parentSessionId });
    return undefined;
  }

  for (const turn of parentSession.dialogTurns) {
    const hasParentTool = turn.modelRounds.some(round =>
      round.items.some(item => item.id === parentToolId)
    );
    if (hasParentTool) {
      return turn.id;
    }
  }

  log.debug('Parent tool turn not found for subagent event', { parentSessionId, parentToolId });
  return undefined;
}

function mirrorNodeToParentTask(context: FlowChatContext, node: ExecutionNode): void {
  if (!node.parentTurnId) {
    log.debug('Cannot mirror subagent execution without parent turn id', {
      parentSessionId: node.parentSessionId,
      parentToolId: node.parentToolId,
      childSessionId: node.childSessionId,
    });
    return;
  }

  context.flowChatStore.updateModelRoundItem(
    node.parentSessionId,
    node.parentTurnId,
    node.parentToolId,
    {
      executionProjection: node,
    } as any,
  );

  debouncedSaveDialogTurn(context, node.parentSessionId, node.parentTurnId, 1500);
}

function touchPendingSubagentFinalization(parentSessionId: string, parentToolId: string): void {
  const pending = pendingSubagentFinalizations.get(buildNodeId(parentSessionId, parentToolId));
  if (!pending) {
    return;
  }

  pending.deadline = Date.now() + SUBAGENT_COMPLETION_QUIET_WINDOW_MS;
}

function finalizePendingSubagent(nodeId: string): void {
  const pending = pendingSubagentFinalizations.get(nodeId);
  if (!pending) {
    return;
  }

  const remainingMs = pending.deadline - Date.now();
  if (remainingMs > 0) {
    pending.timer = setTimeout(() => finalizePendingSubagent(nodeId), remainingMs);
    return;
  }

  pendingSubagentFinalizations.delete(nodeId);
  const node = executionGraphStore.finalizeNodeByParent(pending.identity, pending.status);
  mirrorNodeToParentTask(pending.context, node);
}

function scheduleSubagentFinalization(pending: PendingSubagentFinalization): void {
  const existing = pendingSubagentFinalizations.get(pending.identity.nodeId);
  if (existing) {
    clearTimeout(existing.timer);
  }

  pendingSubagentFinalizations.set(pending.identity.nodeId, pending);
}

export function routeTextChunkToToolCard(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  data: SubagentTextChunkData
): void {
  touchPendingSubagentFinalization(parentSessionId, parentToolId);
  const parentTurnId = resolveParentTurnId(context, parentSessionId, parentToolId);
  const node = executionGraphStore.ingestText({
    nodeId: buildNodeId(parentSessionId, parentToolId),
    parentSessionId,
    parentTurnId,
    parentToolId,
    childSessionId: data.sessionId,
  }, {
    roundId: data.roundId,
    text: data.text,
    contentType: data.contentType,
    isThinkingEnd: data.isThinkingEnd,
  });
  mirrorNodeToParentTask(context, node);
}

export function routeToolEventToToolCard(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  data: SubagentToolEventData,
  _onTodoWriteResult?: (sessionId: string, turnId: string, result: any) => void,
): void {
  touchPendingSubagentFinalization(parentSessionId, parentToolId);
  const parentTurnId = resolveParentTurnId(context, parentSessionId, parentToolId, data.subagentParentInfo?.dialogTurnId);
  const node = executionGraphStore.ingestToolEvent({
    nodeId: buildNodeId(parentSessionId, parentToolId),
    parentSessionId,
    parentTurnId,
    parentToolId,
    childSessionId: data.sessionId,
  }, data.toolEvent);
  mirrorNodeToParentTask(context, node);
}

export function finalizeSubagentRunForParent(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  childSessionId: string,
  status: ExecutionFinalizeStatus,
  parentTurnId?: string,
): void {
  const resolvedParentTurnId = resolveParentTurnId(context, parentSessionId, parentToolId, parentTurnId);
  const nodeId = buildNodeId(parentSessionId, parentToolId);
  const existing = pendingSubagentFinalizations.get(nodeId);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const pending: PendingSubagentFinalization = {
    context,
    identity: {
      nodeId,
      parentSessionId,
      parentTurnId: resolvedParentTurnId,
      parentToolId,
      childSessionId,
    },
    status,
    deadline: Date.now() + SUBAGENT_COMPLETION_QUIET_WINDOW_MS,
    timer: setTimeout(() => finalizePendingSubagent(nodeId), SUBAGENT_COMPLETION_QUIET_WINDOW_MS),
  };

  scheduleSubagentFinalization(pending);
  const drainingNode = executionGraphStore.beginNodeDrain(pending.identity, status);
  mirrorNodeToParentTask(context, drainingNode);
}

export function routeTextChunkToToolCardInternal(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  chunkData: {
    sessionId: string;
    turnId: string;
    roundId: string;
    text: string;
    contentType: string;
    isThinkingEnd?: boolean;
  }
): void {
  routeTextChunkToToolCard(context, parentSessionId, parentToolId, chunkData);
}

export function routeToolEventToToolCardInternal(
  context: FlowChatContext,
  parentSessionId: string,
  parentToolId: string,
  eventData: ToolEventData,
  _onTodoWriteResult?: (sessionId: string, turnId: string, result: any) => void,
): void {
  routeToolEventToToolCard(context, parentSessionId, parentToolId, eventData);
}
