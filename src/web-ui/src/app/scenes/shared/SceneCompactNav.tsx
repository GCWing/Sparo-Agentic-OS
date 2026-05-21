import React from 'react';
import { Button } from '@/design-system';
import './sceneCompactNav.scss';

export interface SceneCompactNavProps {
  title: string;
  className?: string;
  children: React.ReactNode;
}

export const SceneCompactNav: React.FC<SceneCompactNavProps> = ({
  title,
  className = '',
  children,
}) => (
  <nav
    className={['sparo-scene-compact-nav', className].filter(Boolean).join(' ')}
    aria-label={title}
  >
    <div className="sparo-scene-compact-nav__header">
      <span className="sparo-scene-compact-nav__title">{title}</span>
    </div>
    <div className="sparo-scene-compact-nav__sections">{children}</div>
  </nav>
);

export interface SceneCompactNavCategoryProps {
  label?: string;
  children: React.ReactNode;
}

export const SceneCompactNavCategory: React.FC<SceneCompactNavCategoryProps> = ({
  label,
  children,
}) => (
  <div className="sparo-scene-compact-nav__category">
    {label ? (
      <div className="sparo-scene-compact-nav__category-header">
        <span className="sparo-scene-compact-nav__category-label">{label}</span>
      </div>
    ) : null}
    <div className="sparo-scene-compact-nav__items">{children}</div>
  </div>
);

export interface SceneCompactNavItemProps {
  label: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  meta?: React.ReactNode;
  nested?: boolean;
  className?: string;
  disabled?: boolean;
}

export const SceneCompactNavItem: React.FC<SceneCompactNavItemProps> = ({
  label,
  active = false,
  onClick,
  meta,
  nested = false,
  className = '',
  disabled = false,
}) => (
  <Button
    type="button"
    variant="ghost"
    disabled={disabled}
    className={[
      'sparo-scene-compact-nav__item',
      nested && 'sparo-scene-compact-nav__item--nested',
      active && 'is-active',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
    onClick={onClick}
  >
    <span className="sparo-scene-compact-nav__item-label">{label}</span>
    {meta != null ? (
      <span className="sparo-scene-compact-nav__item-meta">{meta}</span>
    ) : null}
  </Button>
);
