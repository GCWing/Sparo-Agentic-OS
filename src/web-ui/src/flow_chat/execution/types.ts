import type {
  AnyFlowItem,
  FlowSubagentExecutionProjection,
  FlowTextItem,
  FlowThinkingItem,
  FlowToolItem,
} from '../types/flow-chat';
import type { ExecutionNodeActivity, ExecutionNodeStatus } from '../runtime/statusModel';

export type ExecutionNodeKind = 'subagentRun';
export type ExecutionEdgeKind = 'delegates';
export type ExecutionStatus = ExecutionNodeStatus;

export interface ExecutionNodeIdentity {
  nodeId: string;
  parentSessionId: string;
  parentTurnId?: string;
  parentToolId: string;
  childSessionId: string;
}

export type ExecutionSummary = FlowSubagentExecutionProjection['summary'];

export type ExecutionNode = FlowSubagentExecutionProjection & {
  kind: ExecutionNodeKind;
  edgeKind: ExecutionEdgeKind;
  items: AnyFlowItem[];
  nodeState?: {
    status: ExecutionNodeStatus;
    activity: ExecutionNodeActivity;
    terminalReason?: string;
    error?: string;
  };
};

export type ExecutionFinalizeStatus = 'completed' | 'error' | 'cancelled';

export type ExecutionTextItem = FlowTextItem | FlowThinkingItem;
export type ExecutionTimelineItem = ExecutionTextItem | FlowToolItem;
