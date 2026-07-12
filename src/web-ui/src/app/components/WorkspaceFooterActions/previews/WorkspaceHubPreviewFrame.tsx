import React from 'react';
import { ArrowRight, ChevronRight, RotateCcw } from 'lucide-react';
import { Button, Skeleton, Tooltip } from '@/design-system';

export type WorkspaceHubPreviewTone = 'accent' | 'positive' | 'warning' | 'danger' | 'neutral';

interface WorkspaceHubPreviewFrameProps {
  category?: string;
  title: string;
  className?: string;
  status?: string;
  statusTone?: WorkspaceHubPreviewTone;
  headerMeta?: React.ReactNode;
  summary?: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

interface WorkspaceHubPreviewSectionProps {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

interface WorkspaceHubPreviewRowProps {
  id?: string;
  icon?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  tone?: WorkspaceHubPreviewTone;
  active?: boolean;
  role?: React.AriaRole;
  ariaSelected?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  tooltip?: React.ReactNode;
}

interface WorkspaceHubPreviewMetric {
  label: string;
  value: React.ReactNode;
  tone?: WorkspaceHubPreviewTone;
}

export const WorkspaceHubPreviewFrame: React.FC<WorkspaceHubPreviewFrameProps> = ({
  category,
  title,
  className = '',
  status,
  statusTone = 'accent',
  headerMeta,
  summary,
  children,
  actions,
}) => (
  <article className={`sparo-workspace-hub-preview ${className}`.trim()}>
    <header className="sparo-workspace-hub-preview__header">
      <div className="sparo-workspace-hub-preview__heading">
        {category && <p className="sparo-workspace-hub-preview__category">{category}</p>}
        <h2 className="sparo-workspace-hub-preview__title">{title}</h2>
      </div>
      {headerMeta ?? (status && (
        <span className={`sparo-workspace-hub-preview__status is-${statusTone}`}>
          <span aria-hidden="true" />
          {status}
        </span>
      ))}
    </header>
    {summary && <div className="sparo-workspace-hub-preview__summary">{summary}</div>}
    <div className="sparo-workspace-hub-preview__content">{children}</div>
    {actions && <footer className="sparo-workspace-hub-preview__actions">{actions}</footer>}
  </article>
);

export const WorkspaceHubPreviewSection: React.FC<WorkspaceHubPreviewSectionProps> = ({
  title,
  meta,
  children,
  className = '',
}) => (
  <section className={`sparo-workspace-hub-preview__section ${className}`.trim()}>
    <div className="sparo-workspace-hub-preview__section-header">
      <h3>{title}</h3>
      {meta && <span>{meta}</span>}
    </div>
    <div className="sparo-workspace-hub-preview__section-body">{children}</div>
  </section>
);

export const WorkspaceHubPreviewRow: React.FC<WorkspaceHubPreviewRowProps> = ({
  id,
  icon,
  title,
  meta,
  trailing,
  tone = 'neutral',
  active = false,
  role,
  ariaSelected,
  onClick,
  ariaLabel,
  tooltip,
}) => {
  const content = (
    <>
      {icon && <span className={`sparo-workspace-hub-preview__row-icon is-${tone}`} aria-hidden="true">{icon}</span>}
      <span className="sparo-workspace-hub-preview__row-copy">
        <span className="sparo-workspace-hub-preview__row-title-line">
          <strong>{title}</strong>
          {trailing !== undefined && trailing !== null && (
            <span className="sparo-workspace-hub-preview__row-trailing">{trailing}</span>
          )}
        </span>
        {meta && <span className="sparo-workspace-hub-preview__row-meta">{meta}</span>}
      </span>
      {onClick && <ChevronRight size={14} className="sparo-workspace-hub-preview__row-chevron" aria-hidden="true" />}
    </>
  );

  if (!onClick) {
    return <div id={id} role={role} aria-selected={ariaSelected} className="sparo-workspace-hub-preview__row">{content}</div>;
  }

  const row = (
    <Button
      id={id}
      role={role}
      aria-selected={ariaSelected}
      variant="ghost"
      size="small"
      className={`sparo-workspace-hub-preview__row is-interactive${active ? ' is-active' : ''}`}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {content}
    </Button>
  );

  if (!tooltip) return row;

  return (
    <Tooltip content={tooltip} placement="right" followCursor>
      {row}
    </Tooltip>
  );
};

export const WorkspaceHubPreviewMetrics: React.FC<{ items: readonly WorkspaceHubPreviewMetric[] }> = ({ items }) => (
  <div className="sparo-workspace-hub-preview__metrics">
    {items.map((item) => (
      <div key={item.label} className={`sparo-workspace-hub-preview__metric is-${item.tone ?? 'neutral'}`}>
        <strong>{item.value}</strong>
        <span>{item.label}</span>
      </div>
    ))}
  </div>
);

export const WorkspaceHubPreviewLoading: React.FC<{ rows?: number }> = ({ rows = 2 }) => (
  <div className="sparo-workspace-hub-preview__loading" aria-busy="true">
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="sparo-workspace-hub-preview__loading-row">
        <Skeleton variant="block" width={30} height={30} />
        <span>
          <Skeleton variant="text" width="55%" />
          <Skeleton variant="text" width="78%" />
        </span>
      </div>
    ))}
  </div>
);

export const WorkspaceHubPreviewEmpty: React.FC<{
  title: string;
}> = ({ title }) => (
  <div className="sparo-workspace-hub-preview__empty">
    <strong>{title}</strong>
  </div>
);

export const WorkspaceHubPreviewError: React.FC<{
  message: string;
  retryLabel: string;
  onRetry: () => void;
}> = ({ message, retryLabel, onRetry }) => (
  <div className="sparo-workspace-hub-preview__error" role="status">
    <span>{message}</span>
    <Button variant="ghost" size="small" onClick={onRetry}>
      <RotateCcw size={13} aria-hidden="true" />
      {retryLabel}
    </Button>
  </div>
);

type WorkspaceHubPreviewActionProps = React.ComponentPropsWithoutRef<typeof Button> & {
  accent?: boolean;
  arrow?: boolean;
};

export const WorkspaceHubPreviewAction = React.forwardRef<
HTMLButtonElement,
WorkspaceHubPreviewActionProps
>(({ accent = false, arrow = false, className = '', children, ...props }, ref) => (
    <Button
      {...props}
      ref={ref}
      variant="ghost"
      size="small"
      className={`sparo-workspace-hub-preview__action${accent ? ' is-accent' : ''} ${className}`.trim()}
    >
      {children}
      {arrow && <ArrowRight size={14} aria-hidden="true" />}
    </Button>
  ));

WorkspaceHubPreviewAction.displayName = 'WorkspaceHubPreviewAction';
