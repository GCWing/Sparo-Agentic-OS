import type { ReproductionCompletion } from '@/shared/markdown';
import { FlowChatManager } from './FlowChatManager';

export async function notifyReproductionCompleted(
  completion: ReproductionCompletion,
): Promise<void> {
  await FlowChatManager.getInstance().sendMessage(
    completion.message,
    undefined,
    completion.shortMessage,
  );
}
