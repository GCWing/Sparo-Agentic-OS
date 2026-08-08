/**
 * @vitest-environment jsdom
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkAppRef } from '../domain/workTypes';
import { WorkIcon } from './WorkIcon';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const catalog = vi.hoisted(() => ({
  listProductAppLibrary: vi.fn(),
  listeners: new Set<() => void>(),
}));

vi.mock('@/infrastructure/api/service-api/AppCatalogAPI', () => ({
  appCatalogAPI: {
    listProductAppLibrary: catalog.listProductAppLibrary,
  },
  subscribeAppCatalogChanges: (listener: () => void) => {
    catalog.listeners.add(listener);
    return () => catalog.listeners.delete(listener);
  },
}));

const appRef: WorkAppRef = {
  kind: 'product_app',
  slotId: 'slides-slot',
  appId: 'slides-app',
  releaseId: 'release-1',
  configRevision: 'config-1',
  dataSchemaVersion: '1',
};

describe('WorkIcon', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    catalog.listProductAppLibrary.mockResolvedValue({
      installed: [{
        id: appRef.appId,
        appId: appRef.appId,
        name: 'Slides',
        icon: {
          kind: 'packageAsset',
          path: 'assets/icon.svg',
          uri: 'asset://slides/icon.svg',
        },
      }],
      discoverable: [],
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('replaces the generic App Work glyph with the App package logo', async () => {
    await act(async () => {
      root.render(
        <WorkIcon
          work={{
            kind: 'app_workflow',
            subject: { kind: 'app', app: appRef, intent: 'run' },
            appRefs: [{ app: appRef, role: 'subject' }],
          }}
          size={24}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(catalog.listProductAppLibrary).toHaveBeenCalledTimes(1);
    const image = container.querySelector<HTMLImageElement>('.app-icon__image');
    expect(image?.getAttribute('src')).toBe('asset://slides/icon.svg');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('uses the compact optical stroke for fallback Work glyphs', async () => {
    await act(async () => {
      root.render(
        <WorkIcon
          work={{ kind: 'one_shot', subject: { kind: 'goal' } }}
          size={18}
        />,
      );
    });

    const svg = container.querySelector('svg');
    const glyph = svg?.querySelector('g');
    expect(svg?.getAttribute('width')).toBe('18');
    expect(Number(glyph?.getAttribute('stroke-width')) * 18 / 48).toBeCloseTo(1.25);
  });
});
