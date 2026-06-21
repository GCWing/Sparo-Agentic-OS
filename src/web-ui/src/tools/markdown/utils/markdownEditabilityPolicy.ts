import type { MarkdownEditabilityAnalysis } from '../tiptap/utils/tiptapMarkdown';

type MarkdownEditabilityPolicyInput = Pick<
  MarkdownEditabilityAnalysis,
  'mode' | 'containsRawHtmlBlocks' | 'containsRenderOnlyBlocks' | 'containsRawHtmlInlines'
>;

export function shouldUseDocumentSourcePreviewFallback(
  editability: MarkdownEditabilityPolicyInput,
  hasFilePath: boolean,
): boolean {
  return hasFilePath && editability.mode === 'unsafe';
}

export function hasSourceBackedMarkdownIslands(
  editability: MarkdownEditabilityPolicyInput,
): boolean {
  return (
    editability.containsRawHtmlBlocks ||
    editability.containsRenderOnlyBlocks ||
    editability.containsRawHtmlInlines
  );
}
