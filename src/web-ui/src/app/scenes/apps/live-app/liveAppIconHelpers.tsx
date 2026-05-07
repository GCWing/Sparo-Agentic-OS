import React from 'react';
import * as LucideIcons from 'lucide-react';
import { LiveAppGlyph } from './liveAppIcons';

const ICON_GRADIENTS = [
  'linear-gradient(135deg, rgba(59,130,246,0.35) 0%, rgba(139,92,246,0.25) 100%)',
  'linear-gradient(135deg, rgba(16,185,129,0.3) 0%, rgba(59,130,246,0.25) 100%)',
  'linear-gradient(135deg, rgba(245,158,11,0.3) 0%, rgba(239,68,68,0.2) 100%)',
  'linear-gradient(135deg, rgba(139,92,246,0.35) 0%, rgba(236,72,153,0.2) 100%)',
  'linear-gradient(135deg, rgba(6,182,212,0.3) 0%, rgba(59,130,246,0.25) 100%)',
  'linear-gradient(135deg, rgba(239,68,68,0.25) 0%, rgba(245,158,11,0.2) 100%)',
];

export function renderLiveAppIcon(name: string, size = 28): React.ReactNode {
  if (name === 'live-app' || name === 'liveapp') {
    return <LiveAppGlyph size={size} strokeWidth={1.5} />;
  }

  const key = name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') as keyof typeof LucideIcons;
  const Icon = LucideIcons[key] as React.ElementType | undefined;

  return Icon
    ? <Icon size={size} strokeWidth={1.5} />
    : <LiveAppGlyph size={size} strokeWidth={1.5} />;
}

export function getLiveAppIconGradient(icon: string): string {
  if (icon === 'live-app' || icon === 'liveapp') {
    return 'linear-gradient(135deg, rgba(56,189,248,0.34) 0%, rgba(59,130,246,0.22) 45%, rgba(168,85,247,0.22) 100%)';
  }

  const idx = (icon.charCodeAt(0) || 0) % ICON_GRADIENTS.length;
  return ICON_GRADIENTS[idx];
}
