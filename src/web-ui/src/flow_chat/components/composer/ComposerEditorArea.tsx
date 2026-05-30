import type React from 'react';
import type { ContextItem, DirectoryContext, FileContext, ImageContext } from '@/shared/types/context';
import type { AgentInfo } from '../../reducers/agentReducer';
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
  spaceToActivate: React.ReactNode;
  removeImage: string;
  quickAction: string;
  commands: string;
  addAgentMenuTitle: string;
  selectHint: string;
  noMatchingCommand: string;
  noMatchingAgent: string;
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
  canSwitchAgents: boolean;
  currentAgent: string;
  mcpPromptCommandsLoading: boolean;
  actions: SlashActionItem[];
  allItems: SlashPickerItem[];
  filteredAgents: AgentInfo[];
  labels: ComposerEditorAreaLabels;
  suggestion?: string | null;
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
  onSelectAgent: (id: string) => void;
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
  canSwitchAgents,
  currentAgent,
  mcpPromptCommandsLoading,
  actions,
  allItems,
  filteredAgents,
  labels,
  suggestion,
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
  onSelectAgent,
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
        suggestion={suggestion}
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
        state={slashCommandState}
        canSwitchAgents={canSwitchAgents}
        currentAgent={currentAgent}
        mcpPromptCommandsLoading={mcpPromptCommandsLoading}
        labels={{
          quickAction: labels.quickAction,
          commands: labels.commands,
          addAgentMenuTitle: labels.addAgentMenuTitle,
          selectHint: labels.selectHint,
          noMatchingCommand: labels.noMatchingCommand,
          noMatchingAgent: labels.noMatchingAgent,
          loadingMcpPrompts: labels.loadingMcpPrompts,
          current: labels.current,
        }}
        actions={actions}
        allItems={allItems}
        filteredAgents={filteredAgents}
        onSelectAction={onSelectAction}
        onSelectAgent={onSelectAgent}
        onSelectPrompt={onSelectPrompt}
        onHoverIndex={onHoverCommandIndex}
      />
    </div>
  );
}
