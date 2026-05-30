import { FLOW_SCROLL_NESTED_BOTTOM_THRESHOLD_PX } from '../FlowScrollPolicy';
import { usePlainFlowScrollController } from './usePlainFlowScrollController';

interface UseNestedFlowScrollControllerOptions {
  isStreaming: boolean;
  dependencies: readonly unknown[];
  resetKey?: unknown;
}

export function useNestedFlowScrollController({
  isStreaming,
  dependencies,
  resetKey,
}: UseNestedFlowScrollControllerOptions) {
  return usePlainFlowScrollController({
    isStreaming,
    dependencies,
    resetKey,
    bottomThresholdPx: FLOW_SCROLL_NESTED_BOTTOM_THRESHOLD_PX,
  });
}
