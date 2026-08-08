import { useCallback, useMemo, useState } from 'react';
import type React from 'react';
import type {
  ComposerDocument,
  ContextReference,
} from '@/shared/types/composer';
import type { ContextItem, DirectoryContext, FileContext } from '@/shared/types/context';
import type {
  AttachmentActivity,
  AttachmentReferenceResolution,
} from '@/shared/stores/contextStore';
import { FileMentionPicker } from '../FileMentionPicker';
import {
  RichTextInput,
  type ComposerIngressContext,
  type MentionState,
  type RichTextInputHandle,
} from '../RichTextInput';
import { ComposerAttachments } from './ComposerAttachments';
import { ComposerContextPeek } from './ComposerContextPeek';
import { ComposerCommandPicker } from './ComposerCommandPicker';
import type { ComposerCommandOption } from './model/composerCommandRegistry';
import type { ComposerCommandInteractionState } from './model/composerState';

interface ComposerEditorAreaLabels {
  placeholder: string;
  spaceToActivate: React.ReactNode;
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
  assets: ContextItem[];
  references: ContextReference[];
  attachmentActivity: AttachmentActivity | null;
  mentionState: MentionState;
  workspacePath?: string;
  commandState: ComposerCommandInteractionState;
  commandOptions: ComposerCommandOption[];
  mcpPromptCommandsLoading: boolean;
  labels: ComposerEditorAreaLabels;
  onChange: (document: ComposerDocument, activeReferenceIds: string[]) => void;
  onLargePaste: (text: string) => ComposerIngressContext | null;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onRemoveAttachment: (assetId: string) => void;
  onRemoveReference: (id: string) => void;
  onCreateReference: (assetId: string) => ContextReference | null;
  onUpdateContext: (id: string, updates: Partial<ContextItem>) => void;
  onMentionStateChange: (state: MentionState) => void;
  onResolveAttachmentReference: (
    context: FileContext | DirectoryContext,
  ) => AttachmentReferenceResolution;
  onCloseMention: () => void;
  onSelectCommandOption: (option: ComposerCommandOption) => void;
  onHoverCommandIndex: (index: number) => void;
}

export function ComposerEditorArea({
  editorRef,
  document,
  draftKey,
  assets,
  references,
  attachmentActivity,
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
  onRemoveAttachment,
  onRemoveReference,
  onCreateReference,
  onUpdateContext,
  onMentionStateChange,
  onResolveAttachmentReference,
  onCloseMention,
  onSelectCommandOption,
  onHoverCommandIndex,
}: ComposerEditorAreaProps) {
  const [peek, setPeek] = useState<{
    assetId: string;
    referenceId?: string;
    anchor: HTMLElement;
  } | null>(null);
  const assetById = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
  const activeReference = peek?.referenceId
    ? references.find(reference => reference.id === peek.referenceId)
    : undefined;
  const activeAsset = peek ? assetById.get(peek.assetId) : undefined;

  const handleOpenReference = useCallback((referenceId: string, anchor: HTMLElement) => {
    const reference = references.find(entry => entry.id === referenceId);
    if (reference) setPeek({ assetId: reference.assetId, referenceId, anchor });
  }, [references]);

  const handleOpenAttachment = useCallback((assetId: string, anchor: HTMLElement) => {
    setPeek({ assetId, anchor });
  }, []);

  const handleInsertReference = useCallback((assetId: string) => {
    const asset = assetById.get(assetId);
    const reference = onCreateReference(assetId);
    if (!asset || !reference) return;
    setPeek(null);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.insertTag(reference, asset);
    });
  }, [assetById, editorRef, onCreateReference]);

  const handleRemoveAttachment = useCallback((assetId: string) => {
    references
      .filter(reference => reference.assetId === assetId)
      .forEach(reference => editorRef.current?.removeTag(reference.id));
    onRemoveAttachment(assetId);
    setPeek(null);
  }, [editorRef, onRemoveAttachment, references]);

  return (
    <div className="sparo-chat-input__input-area">
      <ComposerAttachments
        assets={assets}
        activity={attachmentActivity}
        onOpen={handleOpenAttachment}
        onRemove={handleRemoveAttachment}
      />
      <div className="sparo-chat-input__editor-stage">
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
          assets={assets}
          references={references}
          onOpenReference={handleOpenReference}
          onRemoveReference={onRemoveReference}
          onMentionStateChange={onMentionStateChange}
          data-testid="chat-input-textarea"
        />
        <div className="sparo-chat-input__space-hint" aria-hidden="true">
          {labels.spaceToActivate}
        </div>
      </div>

      <FileMentionPicker
        isOpen={mentionState.isActive}
        searchQuery={mentionState.query}
        workspacePath={workspacePath}
        onSelect={(context: FileContext | DirectoryContext) => {
          const resolution = onResolveAttachmentReference(context);
          if (resolution.kind === 'rejected') return;
          editorRef.current?.insertTagReplacingMention(resolution.reference, resolution.asset);
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
      {peek && activeAsset ? (
        <ComposerContextPeek
          reference={activeReference}
          asset={activeAsset}
          anchor={peek.anchor}
          openOptions={{
            readOnly: false,
            draftKey,
            workspacePath,
            onUpdate: onUpdateContext,
          }}
          onDismiss={() => setPeek(null)}
          onInsertReference={activeReference ? undefined : handleInsertReference}
          onRemoveAttachment={activeReference ? undefined : handleRemoveAttachment}
          onRemoveReference={activeReference ? onRemoveReference : undefined}
        />
      ) : null}
    </div>
  );
}
