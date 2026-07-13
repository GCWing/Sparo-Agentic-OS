import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Check, X } from 'lucide-react';
import { IconButton } from '@/design-system';
import type { ContextItem } from '@/shared/types/context';
import { createComposerTextDocument, getComposerText } from '@/shared/types/composer';
import { RichTextInput, type MentionState, type RichTextInputHandle } from '../RichTextInput';
import type { DialogTurn } from '../../types/flow-chat';

interface UserMessageEditComposerProps {
  value: string;
  images?: DialogTurn['userMessage']['images'];
  disabled?: boolean;
  labels: {
    placeholder: string;
    submit: string;
    cancel: string;
    removeImage: string;
  };
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function UserMessageEditComposer({
  value,
  images,
  disabled = false,
  labels,
  onChange,
  onSubmit,
  onCancel,
}: UserMessageEditComposerProps) {
  const editorRef = useRef<RichTextInputHandle>(null);
  const [mentionState, setMentionState] = useState<MentionState>({
    isActive: false,
    query: '',
    startOffset: 0,
  });

  useEffect(() => {
    const id = window.setTimeout(() => editorRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  const handleChange = useCallback((nextDocument: ReturnType<typeof createComposerTextDocument>, _contexts: ContextItem[]) => {
    onChange(getComposerText(nextDocument));
  }, [onChange]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  }, [onCancel, onSubmit]);

  return (
    <div className="user-message-edit-composer">
      {images && images.length > 0 && (
        <div className="user-message-edit-composer__images">
          {images.map(image => {
            const src = image.dataUrl || (image.imagePath ? `https://asset.localhost/${encodeURIComponent(image.imagePath)}` : undefined);
            return src ? (
              <div key={image.id} className="user-message-edit-composer__image-thumb">
                <img src={src} alt={image.name} />
              </div>
            ) : null;
          })}
        </div>
      )}

      <div className="user-message-edit-composer__body sparo-chat-input sparo-chat-input--inline-edit">
        <div className="sparo-chat-input__container">
          <div className="sparo-chat-input__box user-message-edit-composer__box">
            <div className="sparo-chat-input__input-area">
              <RichTextInput
                ref={editorRef}
                document={createComposerTextDocument(value)}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder={labels.placeholder}
                disabled={disabled}
                contexts={[]}
                openContextOptions={{ readOnly: true }}
                onRemoveContext={() => {}}
                onMentionStateChange={setMentionState}
              />
              {mentionState.isActive && null}
            </div>
            <div className="user-message-edit-composer__actions">
              <IconButton
                aria-label={labels.cancel}
                tooltip={labels.cancel}
                className="user-message-edit-composer__action"
                disabled={disabled}
                onClick={onCancel}
                shape="circle"
                size="small"
                variant="ghost"
              >
                <X size={13} />
              </IconButton>
              <IconButton
                aria-label={labels.submit}
                tooltip={labels.submit}
                className="sparo-chat-input__send-action user-message-edit-composer__submit"
                disabled={disabled || !value.trim()}
                isLoading={disabled}
                onClick={onSubmit}
                shape="circle"
                size="small"
                variant="danger"
              >
                <Check size={13} />
              </IconButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
