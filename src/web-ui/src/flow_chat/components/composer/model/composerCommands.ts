import type { MCPPromptMessage } from '@/infrastructure/api/service-api/MCPAPI';

export type ComposerMcpPromptCommand = {
  kind: 'prompt-template';
  id: string;
  command: string;
  label: string;
  serverId: string;
  serverName: string;
  promptName: string;
  description?: string;
  arguments: Array<{
    name: string;
    required: boolean;
    description?: string;
  }>;
};

export function buildMcpPromptSlashCommand(serverId: string, promptName: string): string {
  return `/${serverId}:${promptName}`;
}

export function parseSlashArguments(input: string): string[] {
  const matches = input.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) || [];
  return matches.map(token => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith('\'') && token.endsWith('\''))
    ) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function renderMcpPromptContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!content || typeof content !== 'object') {
    return '[Unsupported MCP prompt content]';
  }

  const block = content as Record<string, unknown>;
  const type = typeof block.type === 'string' ? block.type : undefined;

  if (type === 'text' && typeof block.text === 'string') {
    return block.text;
  }

  if (type === 'image') {
    return `[Image${typeof block.mimeType === 'string' ? `: ${block.mimeType}` : ''}]`;
  }

  if (type === 'audio') {
    return `[Audio${typeof block.mimeType === 'string' ? `: ${block.mimeType}` : ''}]`;
  }

  if (type === 'resource_link') {
    const uri = typeof block.uri === 'string' ? block.uri : 'unknown';
    const name = typeof block.name === 'string' ? block.name : undefined;
    return name ? `[Resource Link: ${name} (${uri})]` : `[Resource Link: ${uri}]`;
  }

  if (type === 'resource' && block.resource && typeof block.resource === 'object') {
    const resource = block.resource as Record<string, unknown>;
    const resourceText =
      typeof resource.text === 'string'
        ? resource.text
        : typeof resource.content === 'string'
          ? resource.content
          : undefined;
    if (resourceText) {
      return resourceText;
    }
    const uri = typeof resource.uri === 'string' ? resource.uri : 'unknown';
    return `[Resource: ${uri}]`;
  }

  return '[Unsupported MCP prompt content]';
}

export function renderMcpPromptMessages(messages: MCPPromptMessage[]): string {
  return messages
    .map(message => {
      const text = renderMcpPromptContent(message.content).trim();
      if (!text) {
        return '';
      }

      switch (message.role) {
        case 'system':
          return text;
        case 'user':
          return `User: ${text}`;
        case 'assistant':
          return `Assistant: ${text}`;
        default:
          return `${message.role}: ${text}`;
      }
    })
    .filter(Boolean)
    .join('\n\n');
}
