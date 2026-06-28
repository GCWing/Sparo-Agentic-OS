import {
  appCatalogAPI,
  type ProductAppCatalogEntry,
} from '@/infrastructure/api/service-api/AppCatalogAPI';
import { productAppWorkRef } from '@/app/agentic-os/work/domain/productAppRefs';
import type { WorkAppRef } from '@/app/agentic-os/work/domain/workTypes';

export async function resolveProductAppCatalogEntry(appId: string): Promise<ProductAppCatalogEntry> {
  return appCatalogAPI.getProductApp(appId);
}

export async function resolveProductAppWorkRef(appId: string): Promise<WorkAppRef> {
  return productAppWorkRef(await resolveProductAppCatalogEntry(appId));
}

export function isApplicationSurfaceProductApp(app: ProductAppCatalogEntry): boolean {
  return app.launch?.kind === 'applicationSurface';
}

export function isAgentSessionProductApp(app: ProductAppCatalogEntry): boolean {
  return app.launch?.kind === 'agentSession';
}
