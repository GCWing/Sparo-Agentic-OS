import { forwardRef } from 'react';
import { SegmentedControl, type SegmentedControlProps } from '../SegmentedControl';
import './DividerSwitch.scss';

export type DividerSwitchProps = Omit<SegmentedControlProps, 'size'> & {
  size?: 'small' | 'medium';
};

export const DividerSwitch = forwardRef<HTMLDivElement, DividerSwitchProps>(({
  ariaLabel,
  className = '',
  disabled = false,
  onChange,
  options,
  size = 'small',
  stretch = false,
  value,
  ...props
}, ref) => (
  <SegmentedControl
    ref={ref}
    ariaLabel={ariaLabel}
    className={[
      'ds-divider-switch',
      size === 'medium' && 'ds-divider-switch--medium',
      className,
    ].filter(Boolean).join(' ')}
    disabled={disabled}
    onChange={onChange}
    options={options}
    size={size === 'medium' ? 'medium' : 'small'}
    stretch={stretch}
    value={value}
    {...props}
  />
));

DividerSwitch.displayName = 'DividerSwitch';
