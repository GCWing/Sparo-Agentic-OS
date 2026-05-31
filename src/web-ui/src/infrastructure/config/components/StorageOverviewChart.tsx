import React, { useMemo, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { IconButton } from '@/design-system';
import './StorageOverviewChart.scss';

export interface StorageOverviewSegment {
  id: string;
  label: string;
  path: string;
  sizeMb: number;
}

interface StorageOverviewChartProps {
  totalMb: number;
  totalLabel: string;
  segments: StorageOverviewSegment[];
  formatSize: (value: number) => string;
  formatShare: (value: number) => string;
  emptyLabel: string;
  openFolderLabel: string;
  onOpenPath: (path: string) => Promise<void>;
}

const RING_SIZE = 168;
const VIEWBOX_PADDING = 8;
const CHART_VIEW_SIZE = RING_SIZE + VIEWBOX_PADDING * 2;
const STROKE_WIDTH = 18;
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CENTER = CHART_VIEW_SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const SEGMENT_COLORS = [
  'var(--ds-color-accent-500)',
  'var(--color-info, #38bdf8)',
  'var(--color-success, #4ade80)',
  'var(--color-warning, #fbbf24)',
  'var(--color-purple-500, #a78bfa)',
  'var(--ds-status-surface-danger-fg, #f87171)',
  'var(--ds-color-accent-300, #93c5fd)',
  'var(--color-teal-500, #2dd4bf)',
  'var(--color-orange-500, #fb923c)',
  'var(--color-pink-500, #f472b6)',
  'var(--color-lime-500, #a3e635)',
  'var(--color-neutral-400, #9ca3af)',
] as const;

export const StorageOverviewChart: React.FC<StorageOverviewChartProps> = ({
  totalMb,
  totalLabel,
  segments,
  formatSize,
  formatShare,
  emptyLabel,
  openFolderLabel,
  onOpenPath,
}) => {
  const [hoveredSegmentId, setHoveredSegmentId] = useState<string | null>(null);
  const [openingSegmentId, setOpeningSegmentId] = useState<string | null>(null);

  const chartSegments = useMemo(() => {
    const total = segments.reduce((sum, segment) => sum + segment.sizeMb, 0);
    if (total <= 0) return [];

    let offset = 0;
    return segments.map((segment, index) => {
      const length = (segment.sizeMb / total) * CIRCUMFERENCE;
      const dasharray = `${length} ${CIRCUMFERENCE - length}`;
      const dashoffset = -offset;
      offset += length;

      return {
        ...segment,
        color: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
        dasharray,
        dashoffset,
        share: (segment.sizeMb / total) * 100,
      };
    });
  }, [segments]);

  const handleOpenPath = async (
    segmentId: string,
    path: string,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    if (!path || openingSegmentId) return;

    setOpeningSegmentId(segmentId);
    try {
      await onOpenPath(path);
    } finally {
      setOpeningSegmentId(null);
    }
  };

  if (segments.length === 0) {
    return <div className="sparo-storage-overview-chart__empty">{emptyLabel}</div>;
  }

  const isHighlighting = hoveredSegmentId !== null;

  return (
    <div
      className={`sparo-storage-overview-chart${isHighlighting ? ' is-highlighting' : ''}`}
      onMouseLeave={() => setHoveredSegmentId(null)}
    >
      <div className="sparo-storage-overview-chart__visual">
        <svg
          className="sparo-storage-overview-chart__svg"
          viewBox={`0 0 ${CHART_VIEW_SIZE} ${CHART_VIEW_SIZE}`}
          role="img"
          aria-label={totalLabel}
          overflow="visible"
        >
          <circle
            className="sparo-storage-overview-chart__track"
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
          />
          {chartSegments.map(segment => {
            const isActive = hoveredSegmentId === segment.id;
            const isDimmed = isHighlighting && !isActive;

            return (
              <circle
                key={segment.id}
                className={[
                  'sparo-storage-overview-chart__segment',
                  isActive ? 'is-active' : '',
                  isDimmed ? 'is-dimmed' : '',
                ].filter(Boolean).join(' ')}
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                stroke={segment.color}
                strokeDasharray={segment.dasharray}
                strokeDashoffset={segment.dashoffset}
                transform={`rotate(-90 ${CENTER} ${CENTER})`}
                onMouseEnter={() => setHoveredSegmentId(segment.id)}
                aria-label={`${segment.label}: ${formatSize(segment.sizeMb)}`}
              />
            );
          })}
        </svg>
        <div className="sparo-storage-overview-chart__center">
          <span className="sparo-storage-overview-chart__total-value">{formatSize(totalMb)}</span>
          <span className="sparo-storage-overview-chart__total-label">{totalLabel}</span>
        </div>
      </div>

      <ul className="sparo-storage-overview-chart__legend">
        {chartSegments.map(segment => {
          const isActive = hoveredSegmentId === segment.id;
          const isDimmed = isHighlighting && !isActive;
          const isOpening = openingSegmentId === segment.id;

          return (
            <li
              className={[
                'sparo-storage-overview-chart__legend-item',
                isActive ? 'is-active' : '',
                isDimmed ? 'is-dimmed' : '',
              ].filter(Boolean).join(' ')}
              key={segment.id}
              onMouseEnter={() => setHoveredSegmentId(segment.id)}
            >
              <span
                className="sparo-storage-overview-chart__legend-swatch"
                style={{ backgroundColor: segment.color }}
                aria-hidden="true"
              />
              <span className="sparo-storage-overview-chart__legend-label">{segment.label}</span>
              <span className="sparo-storage-overview-chart__legend-value">
                {formatSize(segment.sizeMb)}
                <span className="sparo-storage-overview-chart__legend-share">
                  {formatShare(segment.share)}%
                </span>
              </span>
              <IconButton
                className="sparo-storage-overview-chart__legend-action"
                aria-label={openFolderLabel}
                tooltip={openFolderLabel}
                tooltipPlacement="top"
                size="small"
                disabled={!segment.path || isOpening}
                onClick={(event) => void handleOpenPath(segment.id, segment.path, event)}
              >
                <FolderOpen size={14} />
              </IconButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default StorageOverviewChart;
