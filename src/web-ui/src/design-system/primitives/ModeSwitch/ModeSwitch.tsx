import { forwardRef, type CSSProperties } from 'react';
import { SegmentedControl, type SegmentedControlProps } from '../SegmentedControl';
import './ModeSwitch.scss';

export interface ModeSwitchProps extends Omit<SegmentedControlProps, 'size'> {
  appearance?: 'divider' | 'slider';
}

type ModeSwitchStyle = CSSProperties & {
  '--ds-mode-switch-active-offset'?: string;
  '--ds-mode-switch-indicator-width'?: string;
  '--ds-mode-switch-option-count'?: number;
};

export const ModeSwitch = forwardRef<HTMLDivElement, ModeSwitchProps>(({
  appearance = 'divider',
  ariaLabel,
  className = '',
  disabled = false,
  onChange,
  options,
  style,
  value,
  ...props
}, ref) => {
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const optionCount = Math.max(1, options.length);
  const resolvedStyle: ModeSwitchStyle = appearance === 'slider'
    ? {
        ...style,
        '--ds-mode-switch-active-offset': `${selectedIndex * 100}%`,
        '--ds-mode-switch-indicator-width': `calc(${100 / optionCount}% - ${4 / optionCount}px)`,
        '--ds-mode-switch-option-count': optionCount,
      }
    : style ?? {};

  return (
    <SegmentedControl
      ref={ref}
      ariaLabel={ariaLabel}
      className={[
        'ds-mode-switch',
        `ds-mode-switch--${appearance}`,
        className,
      ].filter(Boolean).join(' ')}
      disabled={disabled}
      onChange={onChange}
      options={options}
      size="small"
      style={resolvedStyle}
      value={value}
      {...props}
    />
  );
});

ModeSwitch.displayName = 'ModeSwitch';
