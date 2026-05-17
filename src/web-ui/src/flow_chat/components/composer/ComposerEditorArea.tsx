import type React from 'react';
import type { ContextItem, DirectoryContext, FileContext, ImageContext } from '@/shared/types/context';
import type { ModeInfo } from '../../reducers/modeReducer';
import { FileMentionPicker } from '../FileMentionPicker';
import { RichTextInput, type MentionState, type RichTextInputHandle } from '../RichTextInput';
import { ComposerAttachments } from './ComposerAttachments';
import { ComposerCommandPicker } from './ComposerCommandPicker';
import type {
  SlashActionItem,
  SlashMcpPromptItem,
  SlashPickerItem,
} from './model/composerCommands';
import type { ComposerSlashCommandState } from './model/composerState';

interface ComposerEditorAreaLabels {
  placeholder: string;
  removeImage: string;
  quickAction: string;
  commands: string;
  addModeMenuTitle: string;
  selectHint: string;
  noMatchingCommand: string;
  noMatchingMode: string;
  loadingMcpPrompts: string;
  current: string;
}

interface ComposerEditorAreaProps {
  editorRef: React.RefObject<RichTextInputHandle | null>;
  value: string;
  contexts: ContextItem[];
  imageContexts: ImageContext[];
  mentionState: MentionState;
  workspacePath?: string;
  slashCommandState: ComposerSlashCommandState;
  canSwitchModes: boolean;
  currentMode: string;
  mcpPromptCommandsLoading: boolean;
  actions: SlashActionItem[];
  allItems: SlashPickerItem[];
  filteredModes: ModeInfo[];
  labels: ComposerEditorAreaLabels;
  onChange: (text: string, activeContexts: ContextItem[]) => void;
  onLargePaste: (text: string) => string | null;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onRemoveContext: (id: string) => void;
  onMentionStateChange: (state: MentionState) => void;
  onAddContext: (context: FileContext | DirectoryContext) => void;
  onCloseMention: () => void;
  onSelectAction: (id: string) => void;
  onSelectMode: (id: string) => void;
  onSelectPrompt: (item: SlashMcpPromptItem) => void;
  onHoverCommandIndex: (index: number) => void;
}

export function ComposerEditorArea({
  editorRef,
  value,
  contexts,
  imageContexts,
  mentionState,
  workspacePath,
  slashCommandState,
  canSwitchModes,
  currentMode,
  mcpPromptCommandsLoading,
  actions,
  allItems,
  filteredModes,
  labels,
  onChange,
  onLargePaste,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  onRemoveContext,
  onMentionStateChange,
  onAddContext,
  onCloseMention,
  onSelectAction,
  onSelectMode,
  onSelectPrompt,
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
        value={value}
        onChange={onChange}
        onLargePaste={onLargePaste}
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        placeholder={labels.placeholder}
        disabled={false}
        contexts={contexts}
        onRemoveContext={onRemoveContext}
        onMentionStateChange={onMentionStateChange}
        data-testid="chat-input-textarea"
      />

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
        state={slashCommandState}
        canSwitchModes={canSwitchModes}
        currentMode={currentMode}
        mcpPromptCommandsLoading={mcpPromptCommandsLoading}
        labels={{
          quickAction: labels.quickAction,
          commands: labels.commands,
          addModeMenuTitle: labels.addModeMenuTitle,
          selectHint: labels.selectHint,
          noMatchingCommand: labels.noMatchingCommand,
          noMatchingMode: labels.noMatchingMode,
          loadingMcpPrompts: labels.loadingMcpPrompts,
          current: labels.current,
        }}
        actions={actions}
        allItems={allItems}
        filteredModes={filteredModes}
        onSelectAction={onSelectAction}
        onSelectMode={onSelectMode}
        onSelectPrompt={onSelectPrompt}
        onHoverIndex={onHoverCommandIndex}
      />
    </div>
  );
}
