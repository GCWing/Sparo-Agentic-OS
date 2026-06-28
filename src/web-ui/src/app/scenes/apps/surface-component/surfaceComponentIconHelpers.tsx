import React from 'react';
import * as LucideIcons from 'lucide-react';
import { SurfaceComponentGlyph } from './surfaceComponentIcons';

type IconGradientSource = 'accent' | 'success' | 'warning' | 'purple' | 'info' | 'danger';

const ICON_GRADIENT_SOURCES: IconGradientSource[] = [
  'accent',
  'success',
  'warning',
  'purple',
  'info',
  'danger',
];

const ICON_GRADIENTS: Record<IconGradientSource, string> = {
  accent: 'linear-gradient(135deg, color-mix(in srgb, var(--ds-color-accent-500) 35%, transparent) 0%, color-mix(in srgb, var(--ds-color-purple-500) 25%, transparent) 100%)',
  success: 'linear-gradient(135deg, color-mix(in srgb, var(--ds-color-success) 30%, transparent) 0%, color-mix(in srgb, var(--ds-color-accent-500) 25%, transparent) 100%)',
  warning: 'linear-gradient(135deg, color-mix(in srgb, var(--ds-color-warning) 30%, transparent) 0%, color-mix(in srgb, var(--ds-color-danger) 20%, transparent) 100%)',
  purple: 'linear-gradient(135deg, color-mix(in srgb, var(--ds-color-purple-500) 35%, transparent) 0%, color-mix(in srgb, var(--ds-color-danger) 20%, transparent) 100%)',
  info: 'linear-gradient(135deg, color-mix(in srgb, var(--ds-color-info) 30%, transparent) 0%, color-mix(in srgb, var(--ds-color-accent-500) 25%, transparent) 100%)',
  danger: 'linear-gradient(135deg, color-mix(in srgb, var(--ds-color-danger) 25%, transparent) 0%, color-mix(in srgb, var(--ds-color-warning) 20%, transparent) 100%)',
};

export function renderSurfaceComponentIcon(name: string, size = 28): React.ReactNode {
  if (name === 'surface-component') {
    return <SurfaceComponentGlyph size={size} strokeWidth={1.5} />;
  }

  const key = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') as keyof typeof LucideIcons;
  const Icon = LucideIcons[key] as React.ElementType | undefined;

  return Icon
    ? <Icon size={size} strokeWidth={1.5} />
    : <SurfaceComponentGlyph size={size} strokeWidth={1.5} />;
}

export function getSurfaceComponentIconGradient(icon: string): string {
  if (icon === 'surface-component') {
    return 'linear-gradient(135deg, color-mix(in srgb, var(--ds-color-info) 34%, transparent) 0%, color-mix(in srgb, var(--ds-color-accent-500) 22%, transparent) 45%, color-mix(in srgb, var(--ds-color-purple-500) 22%, transparent) 100%)';
  }

  const idx = (icon.charCodeAt(0) || 0) % ICON_GRADIENT_SOURCES.length;
  return ICON_GRADIENTS[ICON_GRADIENT_SOURCES[idx]];
}
