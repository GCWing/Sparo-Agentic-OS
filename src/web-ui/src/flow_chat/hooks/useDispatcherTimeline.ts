/**
 * useDispatcherTimeline — subscribes to the dispatcher timeline projection.
 *
 * The projection itself lives in flowChatProjectionScheduler so the dispatcher
 * surface shares the same projection/cache boundary as the main and nested
 * FlowChat virtual surfaces.
 */

import { useMemo } from 'react';
import {
  getDispatcherTimelineProjection,
  getDispatcherTimelineSignature,
  type DispatcherTimelineBucket,
  type DispatcherTimelineBucketId,
  type DispatcherTimelineData,
  type DispatcherTimelineSession,
  type DispatcherTimelineTurn,
} from '../projections/flowChatProjectionScheduler';
import { flowChatStore } from '../store/FlowChatStore';
import { useFlowChatStoreSelector } from './useFlowChatStoreSelector';

export type {
  DispatcherTimelineBucket,
  DispatcherTimelineBucketId,
  DispatcherTimelineData,
  DispatcherTimelineSession,
  DispatcherTimelineTurn,
};

export function useDispatcherTimeline(): DispatcherTimelineData {
  const timelineSignature = useFlowChatStoreSelector(getDispatcherTimelineSignature);

  return useMemo(
    () => {
      void timelineSignature;
      return getDispatcherTimelineProjection(flowChatStore.getState());
    },
    [timelineSignature]
  );
}
