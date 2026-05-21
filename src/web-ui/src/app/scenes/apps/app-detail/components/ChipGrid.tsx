/**
 * Reusable on/off chip grid used by Tools and Skills sections.
 *
 * In edit mode, every chip becomes a toggle. In read mode, only enabled chips
 * are shown so the user can quickly scan what is currently in scope.
 */
import React, { useMemo } from 'react';

export interface ChipOption {
  key: string;
  label: string;
  description?: string;
}

export interface ChipGridProps {
  options: ChipOption[];
  enabled: string[];
  editing: boolean;
  onToggle?: (key: string) => void;
  emptyLabel?: string;
}

export const ChipGrid: React.FC<ChipGridProps> = ({
  options,
  enabled,
  editing,
  onToggle,
  emptyLabel,
}) => {
  const enabledSet = useMemo(() => new Set(enabled), [enabled]);
  const sortedOptions = useMemo(() => {
    if (!editing) {
      return options.filter((opt) => enabledSet.has(opt.key));
    }
    return [...options].sort((a, b) => {
      const aOn = enabledSet.has(a.key);
      const bOn = enabledSet.has(b.key);
      if (aOn === bOn) return a.label.localeCompare(b.label);
      return aOn ? -1 : 1;
    });
  }, [options, enabledSet, editing]);

  if (sortedOptions.length === 0) {
    return <p className="app-detail-chip-grid__empty">{emptyLabel ?? '—'}</p>;
  }

  return (
    <div className="app-detail-chip-grid">
      {sortedOptions.map((opt) => {
        const isOn = enabledSet.has(opt.key);
        if (!editing) {
          return (
            <span
              key={opt.key}
              className="app-detail-chip is-on is-static"
              title={opt.description || opt.label}
            >
              {opt.label}
            </span>
          );
        }
        return (
          <button
            key={opt.key}
            type="button"
            className={['app-detail-chip', isOn && 'is-on'].filter(Boolean).join(' ')}
            title={opt.description || opt.label}
            onClick={() => onToggle?.(opt.key)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};
