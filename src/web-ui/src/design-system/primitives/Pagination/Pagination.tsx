import React, { forwardRef, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './Pagination.scss';

export interface PaginationProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  page: number;
  pageCount: number;
  onChange?: (page: number) => void;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  label?: string;
}

export const Pagination = forwardRef<HTMLDivElement, PaginationProps>(
  ({
    page,
    pageCount,
    onChange,
    disabled = false,
    loading = false,
    compact = false,
    label = 'Pagination',
    className = '',
    ...props
  }, ref) => {
    const normalizedPageCount = Math.max(1, pageCount);
    const currentPage = Math.min(Math.max(1, page), normalizedPageCount);
    const visiblePages = useMemo(() => {
      const pages = new Set([1, normalizedPageCount, currentPage - 1, currentPage, currentPage + 1]);
      return Array.from(pages)
        .filter((nextPage) => nextPage >= 1 && nextPage <= normalizedPageCount)
        .sort((a, b) => a - b);
    }, [currentPage, normalizedPageCount]);

    const goToPage = (nextPage: number) => {
      if (disabled || loading || nextPage === currentPage) return;
      onChange?.(Math.min(Math.max(1, nextPage), normalizedPageCount));
    };

    const renderPages = () => {
      const items: React.ReactNode[] = [];
      visiblePages.forEach((nextPage, index) => {
        const previousPage = visiblePages[index - 1];
        if (previousPage && nextPage - previousPage > 1) {
          items.push(
            <span key={`gap-${nextPage}`} className="ds-pagination__gap" aria-hidden="true">
              ...
            </span>
          );
        }
        items.push(
          <button
            key={nextPage}
            className={[
              'ds-pagination__button',
              currentPage === nextPage && 'ds-pagination__button--current',
            ].filter(Boolean).join(' ')}
            type="button"
            aria-current={currentPage === nextPage ? 'page' : undefined}
            aria-label={`Go to page ${nextPage}`}
            disabled={disabled || loading || currentPage === nextPage}
            onClick={() => goToPage(nextPage)}
          >
            {nextPage}
          </button>
        );
      });
      return items;
    };

    return (
      <nav
        ref={ref}
        className={[
          'ds-pagination',
          compact && 'ds-pagination--compact',
          loading && 'ds-pagination--loading',
          className,
        ].filter(Boolean).join(' ')}
        aria-label={label}
        aria-busy={loading || undefined}
        {...props}
      >
        <button
          className="ds-pagination__button ds-pagination__button--icon"
          type="button"
          aria-label="Previous page"
          disabled={disabled || loading || currentPage <= 1}
          onClick={() => goToPage(currentPage - 1)}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        {!compact && <div className="ds-pagination__pages">{renderPages()}</div>}
        <span className="ds-pagination__summary">
          {currentPage} / {normalizedPageCount}
        </span>
        <button
          className="ds-pagination__button ds-pagination__button--icon"
          type="button"
          aria-label="Next page"
          disabled={disabled || loading || currentPage >= normalizedPageCount}
          onClick={() => goToPage(currentPage + 1)}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </nav>
    );
  }
);

Pagination.displayName = 'Pagination';
