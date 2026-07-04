import { browser } from '@wdio/globals';

export async function callProductAppRuntimeBackend(
  productAppId: string,
  target: string,
  input: Record<string, unknown>,
  targetWorkspacePath: string,
): Promise<any> {
  return browser.execute(async (runtimeProductAppId, targetAction, payload, path) => {
    const { productAppRuntimeHostAPI } = await import('/src/infrastructure/api/service-api/ProductAppRuntimeHostAPI.ts');
    const { flowChatStore } = await import('/src/flow_chat/store/FlowChatStore.ts');
    const panel = document
      .querySelector(`[data-testid="product-app-runtime-panel"][data-product-app-id="${runtimeProductAppId}"]`);
    const hostId = panel?.getAttribute('data-app-id');
    if (!hostId) {
      throw new Error(`${runtimeProductAppId} Product App runtime host not found`);
    }

    const binding = Array.from(flowChatStore.getState().sessions.values())
      .map((session: any) => session.customMetadata?.productAppRuntime)
      .find((candidate: any) =>
        candidate?.appId === runtimeProductAppId &&
        candidate?.hostSurfaceId === hostId &&
        candidate?.runtimeContext
      );
    const runtimeContext = binding?.runtimeContext;
    if (!runtimeContext) {
      throw new Error(`${runtimeProductAppId} Product App runtimeContext not found`);
    }

    return productAppRuntimeHostAPI.backendCall(
      hostId,
      targetAction,
      payload,
      { runtimeContext, workspacePath: path },
    );
  }, productAppId, target, input, targetWorkspacePath);
}
