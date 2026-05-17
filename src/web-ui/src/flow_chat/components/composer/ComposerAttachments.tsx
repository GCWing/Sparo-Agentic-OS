import { Image, X } from 'lucide-react';
import { IconButton } from '@/design-system';
import type { ImageContext } from '@/shared/types/context';

interface ComposerAttachmentsProps {
  images: ImageContext[];
  removeLabel: string;
  onRemove: (id: string) => void;
}

export function ComposerAttachments({ images, removeLabel, onRemove }: ComposerAttachmentsProps) {
  if (images.length === 0) {
    return null;
  }

  return (
    <div
      className="sparo-chat-input__image-strip"
      data-testid="chat-input-image-strip"
    >
      {images.map(image => {
        const previewUrl = image.thumbnailUrl || image.dataUrl;
        return (
          <div
            key={image.id}
            className="sparo-chat-input__image-chip"
            title={image.imageName}
          >
            {previewUrl ? (
              <img
                className="sparo-chat-input__image-chip-thumb"
                src={previewUrl}
                alt={image.imageName}
              />
            ) : (
              <div className="sparo-chat-input__image-chip-thumb sparo-chat-input__image-chip-thumb--placeholder">
                <Image size={14} />
              </div>
            )}
            <IconButton
              aria-label={removeLabel}
              className="sparo-chat-input__image-chip-remove"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(image.id);
              }}
              size="xs"
            >
              <X size={12} />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}
