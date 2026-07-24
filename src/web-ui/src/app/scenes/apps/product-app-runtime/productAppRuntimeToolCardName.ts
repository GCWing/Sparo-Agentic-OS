function manifestSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function productAppFlowChatToolName(appId: string, cardId: string): string {
  return `productapp__${manifestSegment(appId)}__${manifestSegment(cardId)}`;
}
