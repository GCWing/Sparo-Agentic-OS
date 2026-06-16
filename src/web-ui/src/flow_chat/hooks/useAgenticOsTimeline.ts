/**
 * useAgenticOsTimeline — subscribes to the Agentic OS timeline projection.
 *
 * The projection itself lives in flowChatProjectionScheduler so the Agentic OS
 * surface shares the same projection/cache boundary as the main and nested
 * FlowChat virtual surfaces.
 */

import { useMemo } from 'react';
import {
  getAgenticOsTimelineProjection,
  getAgenticOsTimelineSignature,
  type AgenticOsTimelineBucket,
  type AgenticOsTimelineBucketId,
  type AgenticOsTimelineData,
  type AgenticOsTimelineSession,
  type AgenticOsTimelineTurn,
} from '../projections/flowChatProjectionScheduler';
import { flowChatStore } from '../store/FlowChatStore';
import { useFlowChatStoreSelector } from './useFlowChatStoreSelector';

export type {
  AgenticOsTimelineBucket,
  AgenticOsTimelineBucketId,
  AgenticOsTimelineData,
  AgenticOsTimelineSession,
  AgenticOsTimelineTurn,
};

export function useAgenticOsTimeline(): AgenticOsTimelineData {
  const timelineSignature = useFlowChatStoreSelector(getAgenticOsTimelineSignature);

  return useMemo(
    () => {
      void timelineSignature;
      return getAgenticOsTimelineProjection(flowChatStore.getState());
    },
    [timelineSignature]
  );
}
