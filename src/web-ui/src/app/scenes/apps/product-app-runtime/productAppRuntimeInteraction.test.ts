import { describe, expect, it } from 'vitest';
import type {
  ProductAppHostSurfaceInteractionChat,
  ProductAppHostSurfaceMeta,
} from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import { buildProductAppRuntimeMetadata } from './productAppRuntimeInteraction';

function pptSurface(chat: ProductAppHostSurfaceInteractionChat): ProductAppHostSurfaceMeta {
  return {
    id: 'builtin-ppt-live',
    name: 'PPT Live',
    description: 'Create presentation drafts and slides',
    icon: { kind: 'monogram', label: 'PPT' },
    category: 'productivity',
    tags: ['presentation'],
    version: 1,
    created_at: 1,
    updated_at: 1,
    permissions: {},
    interaction: {
      mode: 'composite',
      chat,
      tabs: [
        {
          id: 'manuscript',
          type: 'product-app-runtime',
          title: 'Text draft',
          route: '/manuscript',
          sidecar: {
            actionId: 'ppt-manuscript',
            icon: 'file-text',
            order: 10,
            availability: 'enabled',
            targetGroup: 'primary',
          },
        },
      ],
    },
  };
}

function metadataFor(chat: ProductAppHostSurfaceInteractionChat) {
  return buildProductAppRuntimeMetadata(pptSurface(chat), {
    intelligentApp: {
      appId: 'builtin-ppt-live',
      displayName: 'PPT Live',
      releaseId: 'release-1',
    },
    scope: { kind: 'system' },
  });
}

describe('buildProductAppRuntimeMetadata', () => {
  it('preserves the app-declared manuscript sidecar contract and separates chat and backend agents', () => {
    const metadata = metadataFor({
      agentType: 'Runno',
      backendAgentType: 'PptLiveAgent',
    });

    expect(metadata.chat).toMatchObject({
      agentType: 'Runno',
      backendAgentType: 'PptLiveAgent',
    });
    expect(metadata.tabs).toEqual([
      expect.objectContaining({
        id: 'manuscript',
        route: '/manuscript',
        sidecar: {
          actionId: 'ppt-manuscript',
          icon: 'file-text',
          order: 10,
          availability: 'enabled',
          targetGroup: 'primary',
        },
      }),
    ]);
  });

  it('falls back to the visible agent when no dedicated backend agent is declared', () => {
    const metadata = metadataFor({ agentType: 'Runno' });

    expect(metadata.chat).toMatchObject({
      agentType: 'Runno',
      backendAgentType: 'Runno',
    });
  });
});
