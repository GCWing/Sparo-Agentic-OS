import React, { forwardRef } from 'react';
import './Scene.scss';

export interface SceneProps extends React.HTMLAttributes<HTMLDivElement> {
  density?: 'compact' | 'normal' | 'comfortable';
}

export const Scene = forwardRef<HTMLDivElement, SceneProps>(
  ({ children, density = 'normal', className = '', ...props }, ref) => (
    <section ref={ref} className={['ds-scene', `ds-scene--${density}`, className].filter(Boolean).join(' ')} {...props}>
      {children}
    </section>
  )
);

Scene.displayName = 'Scene';

export interface SceneHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
}

export const SceneHeader = forwardRef<HTMLDivElement, SceneHeaderProps>(
  ({ title, description, eyebrow, actions, children, className = '', ...props }, ref) => (
    <header ref={ref} className={['ds-scene-header', className].filter(Boolean).join(' ')} {...props}>
      <div className="ds-scene-header__copy">
        {eyebrow && <div className="ds-scene-header__eyebrow">{eyebrow}</div>}
        <h1 className="ds-scene-header__title">{title}</h1>
        {description && <p className="ds-scene-header__description">{description}</p>}
        {children}
      </div>
      {actions && <div className="ds-scene-header__actions">{actions}</div>}
    </header>
  )
);

SceneHeader.displayName = 'SceneHeader';

export const SceneBody = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ children, className = '', ...props }, ref) => (
    <div ref={ref} className={['ds-scene-body', className].filter(Boolean).join(' ')} {...props}>
      {children}
    </div>
  )
);

SceneBody.displayName = 'SceneBody';

export interface SceneRailProps extends React.HTMLAttributes<HTMLElement> {
  side?: 'left' | 'right';
}

export const SceneRail = forwardRef<HTMLElement, SceneRailProps>(
  ({ children, side = 'left', className = '', ...props }, ref) => (
    <aside ref={ref} className={['ds-scene-rail', `ds-scene-rail--${side}`, className].filter(Boolean).join(' ')} {...props}>
      {children}
    </aside>
  )
);

SceneRail.displayName = 'SceneRail';
