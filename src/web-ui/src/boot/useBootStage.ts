import { useEffect, useState } from 'react';
import {
  type BootStage,
  getBootStage,
  initBootStageBridge,
  subscribeBootStage,
} from './bootStage';

/**
 * React hook returning the current backend boot stage. Renders nothing until
 * the bridge has been initialized; consumers should treat `null` as "still
 * negotiating".
 */
export function useBootStage(): BootStage | null {
  const [stage, setStage] = useState<BootStage | null>(() => getBootStage());

  useEffect(() => {
    void initBootStageBridge();
    return subscribeBootStage(setStage);
  }, []);

  return stage;
}
