import {
  registerDeclaredToolCardManifest,
  registerToolCardManifestSource,
  unregisterDeclaredToolCardManifest,
  type DynamicToolCardManifest,
} from '@/flow_chat/tool-cards/ToolManifestSync';
import type { AppDefinedToolCardSpec } from '@/flow_chat/types/flow-chat';
import { productAppFlowChatToolName } from './productAppRuntimeToolCardName';

interface ProductAppFlowChatCardDeclaration {
  id: string;
  description?: string;
  ui?: unknown;
}

interface ProductAppToolCardManifestInput {
  appId: string;
  flowChatCards?: readonly ProductAppFlowChatCardDeclaration[];
}

const manifestByToolName = new Map<string, DynamicToolCardManifest>();
const toolNamesByAppId = new Map<string, Set<string>>();

registerToolCardManifestSource('product-app-runtime', {
  owns: toolName => toolName.startsWith('productapp__'),
  resolve: toolName => manifestByToolName.get(toolName) ?? null,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function declaredCard(declaration: ProductAppFlowChatCardDeclaration): AppDefinedToolCardSpec | null {
  if (!isRecord(declaration.ui) || !isRecord(declaration.ui.card)) return null;
  return declaration.ui.card as AppDefinedToolCardSpec;
}

export function registerProductAppRuntimeToolCardManifests(
  metadata: ProductAppToolCardManifestInput,
): void {
  if (!metadata.flowChatCards) return;

  const nextToolNames = new Set<string>();
  for (const declaration of metadata.flowChatCards) {
    const card = declaredCard(declaration);
    if (!card) continue;
    const toolName = productAppFlowChatToolName(metadata.appId, declaration.id);
    if (toolName.endsWith('__')) continue;
    const manifest: DynamicToolCardManifest = {
      name: toolName,
      description: declaration.description,
      isReadonly: true,
      needsPermissions: false,
      ui: { card },
    };
    nextToolNames.add(toolName);
    manifestByToolName.set(toolName, manifest);
    registerDeclaredToolCardManifest(manifest);
  }

  for (const previousToolName of toolNamesByAppId.get(metadata.appId) ?? []) {
    if (nextToolNames.has(previousToolName)) continue;
    manifestByToolName.delete(previousToolName);
    unregisterDeclaredToolCardManifest(previousToolName);
  }
  toolNamesByAppId.set(metadata.appId, nextToolNames);
}
