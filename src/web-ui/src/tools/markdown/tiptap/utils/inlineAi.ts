export function sanitizeInlineAiMarkdownResponse(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const fencedMatch = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  return trimmed;
}
