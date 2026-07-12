import {
  Cpu,
  Boxes,
  Component,
  Layers,
  MessageSquare,
  Settings2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentKind } from '@/shared/types/app-manifest';

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
