import { forwardRef, type HTMLAttributes } from 'react';

import sparoMotionMark from '../brand/sparo-mark-256.png';
import './SparoLogoMotion.scss';

export type SparoLogoMotionState = 'startup' | 'thinking' | 'processing';

export interface SparoLogoMotionProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Preserves the canonical square crop at every rendered size. */
  size?: number | string;
  /** Maps product lifecycle state to an approved material-logo behavior. */
  motion?: SparoLogoMotionState;
  /** Pauses the current animation without changing the supplied raster artwork. */
  active?: boolean;
  /** Removes the status announcement when adjacent text already communicates state. */
  decorative?: boolean;
  /** Accessible state label. Defaults to a concise English lifecycle label. */
  label?: string;
}

const DEFAULT_LABELS: Record<SparoLogoMotionState, string> = {
  startup: 'Sparo OS is starting',
  thinking: 'Sparo OS is thinking',
  processing: 'Sparo OS is processing',
};

export const SparoLogoMotion = forwardRef<HTMLDivElement, SparoLogoMotionProps>(({
  size = 160,
  motion = 'thinking',
  active = true,
  decorative = false,
  label,
  className,
  style,
  ...props
}, ref) => {
  const classes = [
    'sparo-logo-motion',
    `sparo-logo-motion--${motion}`,
    active ? null : 'sparo-logo-motion--paused',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={ref}
      className={classes}
      data-motion={motion}
      data-active={active ? 'true' : 'false'}
      role={decorative ? undefined : 'status'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label ?? DEFAULT_LABELS[motion]}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      <img className="sparo-logo-motion__surface" src={sparoMotionMark} alt="" draggable={false} />
      <img className="sparo-logo-motion__focus" src={sparoMotionMark} alt="" draggable={false} aria-hidden="true" />
      <span className="sparo-logo-motion__sweep" aria-hidden="true" />
    </div>
  );
});

SparoLogoMotion.displayName = 'SparoLogoMotion';

type StateAnimationProps = Omit<SparoLogoMotionProps, 'motion'>;

export const SparoStartupAnimation = forwardRef<HTMLDivElement, StateAnimationProps>(
  (props, ref) => <SparoLogoMotion ref={ref} motion="startup" {...props} />,
);
SparoStartupAnimation.displayName = 'SparoStartupAnimation';

export const SparoThinkingAnimation = forwardRef<HTMLDivElement, StateAnimationProps>(
  (props, ref) => <SparoLogoMotion ref={ref} motion="thinking" {...props} />,
);
SparoThinkingAnimation.displayName = 'SparoThinkingAnimation';

export const SparoProcessingAnimation = forwardRef<HTMLDivElement, StateAnimationProps>(
  (props, ref) => <SparoLogoMotion ref={ref} motion="processing" {...props} />,
);
SparoProcessingAnimation.displayName = 'SparoProcessingAnimation';
