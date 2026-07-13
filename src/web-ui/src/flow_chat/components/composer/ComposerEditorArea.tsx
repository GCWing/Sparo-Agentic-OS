import type React from 'react';
import type { ComposerDocument } from '@/shared/types/composer';
import type { ContextItem, DirectoryContext, FileContext, ImageContext } from '@/shared/types/context';
import { FileMentionPicker } from '../FileMentionPicker';
import { RichTextInput, type MentionState, type RichTextInputHandle } from '../RichTextInput';
import { ComposerAttachments } from './ComposerAttachments';
import { ComposerCommandPicker } from './ComposerCommandPicker';
import type { ComposerCommandOption } from './model/composerCommandRegistry';
import type { ComposerCommandInteractionState } from './model/composerState';

interface ComposerEditorAreaLabels {
  placeholder: string;
  spaceToActivate: React.ReactNode;
  removeImage: string;
  commands: string;
  selectHint: string;
  noMatchingCommand: string;
  loadingMcpPrompts: string;
  current: string;
}

interface ComposerEditorAreaProps {
  editorRef: React.RefObject<RichTextInputHandle | null>;
  document: ComposerDocument;
  draftKey: string;
  contexts: ContextItem[];
  imageContexts: ImageContext[];
  mentionState: MentionState;
  workspacePath?: string;
  commandState: ComposerCommandInteractionState;
  commandOptions: ComposerCommandOption[];
  mcpPromptCommandsLoading: boolean;
  labels: ComposerEditorAreaLabels;
  onChange: (document: ComposerDocument, activeContexts: ContextItem[]) => void;
  onLargePaste: (text: string) => ContextItem | null;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onRemoveContext: (id: string) => void;
  onUpdateContext: (id: string, updates: Partial<ContextItem>) => void;
  onMentionStateChange: (state: MentionState) => void;
  onAddContext: (context: FileContext | DirectoryContext) => void;
  onCloseMention: () => void;
  onSelectCommandOption: (option: ComposerCommandOption) => void;
  onHoverCommandIndex: (index: number) => void;
}

export function ComposerEditorArea({
  editorRef,
  document,
  draftKey,
  contexts,
  imageContexts,
  mentionState,
  workspacePath,
  commandState,
  commandOptions,
  mcpPromptCommandsLoading,
  labels,
  onChange,
  onLargePaste,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  onRemoveContext,
  onUpdateContext,
  onMentionStateChange,
  onAddContext,
  onCloseMention,
  onSelectCommandOption,
  onHoverCommandIndex,
}: ComposerEditorAreaProps) {
  return (
    <div className="sparo-chat-input__input-area">
      <ComposerAttachments
        images={imageContexts}
        removeLabel={labels.removeImage}
        onRemove={onRemoveContext}
      />
      <RichTextInput
        ref={editorRef as React.RefObject<RichTextInputHandle>}
        document={document}
        onChange={onChange}
        onLargePaste={onLargePaste}
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        placeholder={labels.placeholder}
        disabled={false}
        contexts={contexts}
        openContextOptions={{
          readOnly: false,
          draftKey,
          workspacePath,
          onUpdate: onUpdateContext,
        }}
        onRemoveContext={onRemoveContext}
        onMentionStateChange={onMentionStateChange}
        data-testid="chat-input-textarea"
      />
      <div className="sparo-chat-input__space-hint" aria-hidden="true">
        {labels.spaceToActivate}
      </div>

      <FileMentionPicker
        isOpen={mentionState.isActive}
        searchQuery={mentionState.query}
        workspacePath={workspacePath}
        onSelect={(context: FileContext | DirectoryContext) => {
          onAddContext(context);
          editorRef.current?.insertTagReplacingMention(context);
        }}
        onClose={onCloseMention}
      />

      <ComposerCommandPicker
        state={commandState}
        options={commandOptions}
        mcpPromptCommandsLoading={mcpPromptCommandsLoading}
        labels={{
          commands: labels.commands,
          selectHint: labels.selectHint,
          noMatchingCommand: labels.noMatchingCommand,
          loadingMcpPrompts: labels.loadingMcpPrompts,
          current: labels.current,
        }}
        onSelectOption={onSelectCommandOption}
        onHoverIndex={onHoverCommandIndex}
      />
    </div>
  );
}
