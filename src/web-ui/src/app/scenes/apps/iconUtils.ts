import {
  AppWindow,
  BriefcaseBusiness,
  Code2,
  Cpu,
  Film,
  Palette,
  Search as SearchIcon,
  Boxes,
  Component,
  Layers,
  MessageSquare,
  Settings2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentKind, ProductAppCatalogEntry } from '@/infrastructure/api/service-api/AppCatalogAPI';

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function appIconFor(app: ProductAppCatalogEntry): LucideIcon {
  const icon = normalized(app.icon);
  const category = normalized(app.category);
  if (icon.includes('film') || category.includes('creative') || app.id.includes('remotion')) return Film;
  if (icon.includes('code') || category.includes('coding')) return Code2;
  if (icon.includes('briefcase') || category.includes('productivity')) return BriefcaseBusiness;
  if (icon.includes('palette') || category.includes('design')) return Palette;
  if (icon.includes('search') || category.includes('analysis')) return SearchIcon;
  if (icon.includes('cpu')) return Cpu;
  return AppWindow;
}

export function componentIconFor(kind: ComponentKind): LucideIcon {
  switch (kind) {
    case 'surface':
      return Layers;
    case 'agent':
      return MessageSquare;
    case 'bridge':
      return Wrench;
    case 'runtime':
      return Cpu;
    case 'tool':
      return Settings2;
    case 'skill':
      return Boxes;
    default:
      return Component;
  }
}
