import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import type { ContextItem } from '../../../../shared/types/context';
import type {
  AttachmentResolution,
  AttachmentResolveOptions,
} from '@/shared/stores/contextStore';
import { CHAT_INPUT_CONFIG } from '../../../constants/chatInputConfig';
import { createImageContextFromFile } from '../../../utils/imageUtils';

const log = createLogger('ComposerMediaInput');

export function useComposerMediaInput({
  resolveAttachment,
  activateInput,
  t,
}: {
  resolveAttachment: (
    context: ContextItem,
    options?: AttachmentResolveOptions,
  ) => AttachmentResolution;
  activateInput: () => void;
  t: TFunction<'flow-chat'>;
}) {
  return useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = CHAT_INPUT_CONFIG.image.acceptedTypes.join(',');
    input.multiple = true;

    input.onchange = async (event) => {
      const files = (event.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      const fileArray = Array.from(files);

      activateInput();
      let rejectedByLimit = false;
      for (const file of fileArray) {
        try {
          const imageContext = await createImageContextFromFile(file);
          const resolution = resolveAttachment(imageContext, {
            maxAssetsOfType: CHAT_INPUT_CONFIG.image.maxCount,
          });
          if (resolution.kind === 'rejected') rejectedByLimit = true;
        } catch (error) {
          log.error('Failed to process image', { fileName: file.name, error });
          notificationService.error(
            `${file.name}: ${error instanceof Error ? error.message : t('error.processingFailed')}`,
            { duration: 3000 },
          );
        }
      }
      if (rejectedByLimit) {
        notificationService.warning(
          t('input.maxImagesWarning', { count: CHAT_INPUT_CONFIG.image.maxCount }),
          { duration: 3000 },
        );
      }
    };

    input.click();
  }, [activateInput, resolveAttachment, t]);
}
