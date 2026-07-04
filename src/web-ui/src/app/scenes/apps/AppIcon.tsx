import React from 'react';
import { AppWindow, type LucideIcon } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import type { AppIconSpec } from '@/infrastructure/api/service-api/AppCatalogAPI';
import './AppIcon.scss';

export interface AppIconSource {
  id: string;
  name: string;
  icon: AppIconSpec;
}

interface AppIconProps {
  app: AppIconSource;
  size?: number;
  className?: string;
  decorative?: boolean;
}

const lucideIconRegistry = LucideIcons as unknown as Record<string, LucideIcon | undefined>;

function cx(...parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ');
}

function monogramFor(app: AppIconSource, icon: AppIconSpec): string {
  const label = icon.kind === 'monogram' ? icon.label : app.name;
  const first = label.trim().match(/[a-z0-9]/i)?.[0] ?? app.id.trim().match(/[a-z0-9]/i)?.[0] ?? 'A';
  return first.toUpperCase();
}

function backgroundFor(icon: AppIconSpec): React.CSSProperties | undefined {
  return 'background' in icon && icon.background
    ? { '--app-icon-bg': icon.background } as React.CSSProperties
    : undefined;
}

export function AppIcon({
  app,
  size = 24,
  className,
  decorative = true,
}: AppIconProps) {
  const { icon } = app;
  const labelProps = decorative
    ? { 'aria-hidden': true }
    : { role: 'img', 'aria-label': app.name };
  const style = {
    '--app-icon-size': `${size}px`,
    width: size,
    height: size,
    ...backgroundFor(icon),
  } as React.CSSProperties;

  if ((icon.kind === 'packageAsset' || icon.kind === 'nativeAsset') && icon.uri) {
    return (
      <span
        className={cx('app-icon', 'app-icon--asset', className)}
        style={style}
        {...labelProps}
      >
        <img className="app-icon__image" src={icon.uri} alt="" draggable={false} />
      </span>
    );
  }

  if (icon.kind === 'lucide') {
    const Icon = lucideIconRegistry[icon.name] ?? AppWindow;
    return (
      <span
        className={cx('app-icon', 'app-icon--lucide', className)}
        style={style}
        {...labelProps}
      >
        <Icon size={Math.round(size * 0.68)} strokeWidth={1.85} aria-hidden />
      </span>
    );
  }

  return (
    <span
      className={cx('app-icon', 'app-icon--monogram', className)}
      style={style}
      {...labelProps}
    >
      <span className="app-icon__monogram">{monogramFor(app, icon)}</span>
    </span>
  );
}

export default AppIcon;
