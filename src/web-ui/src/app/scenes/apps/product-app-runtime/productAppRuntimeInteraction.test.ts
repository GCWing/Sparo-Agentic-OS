import { describe, expect, it } from 'vitest';
import type {
  ProductAppHostSurfaceInteractionChat,
  ProductAppHostSurfaceMeta,
} from '@/infrastructure/api/service-api/ProductAppRuntimeHostAPI';
import { buildProductAppRuntimeMetadata } from './productAppRuntimeInteraction';

function appSurface(chat: ProductAppHostSurfaceInteractionChat): ProductAppHostSurfaceMeta {
  return {
    id: 'sample-product-app',
    name: 'Sample Product App',
    description: 'A sample composite Product App',
    icon: { kind: 'monogram', label: 'SA' },
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
  return buildProductAppRuntimeMetadata(appSurface(chat), {
    intelligentApp: {
      appId: 'sample-product-app',
      displayName: 'Sample Product App',
      releaseId: 'release-1',
      workMultiplicity: 'multiple',
    },
    scope: { kind: 'system' },
  });
}

describe('buildProductAppRuntimeMetadata', () => {
  it('preserves app-declared sidecar metadata with one app-private chat agent', () => {
    const metadata = metadataFor({
      agentType: 'sample-agent',
      backendAgentType: 'sample-agent',
    });

    expect(metadata.chat).toMatchObject({
      agentType: 'sample-agent',
      backendAgentType: 'sample-agent',
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
    expect(metadata.workMultiplicity).toBe('multiple');
  });

  it('falls back to the visible agent when no dedicated backend agent is declared', () => {
    const metadata = metadataFor({ agentType: 'Runno' });

    expect(metadata.chat).toMatchObject({
      agentType: 'Runno',
      backendAgentType: 'Runno',
    });
  });
});
