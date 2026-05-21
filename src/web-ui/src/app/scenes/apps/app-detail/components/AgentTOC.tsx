/**
 * AgentTOC — sticky right rail showing all Sections of the active Agent.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavigationList, NavigationListItem } from '@/design-system';

export interface AgentTOCItem {
  key: string;
  id: string;
  label: string;
  dirty?: boolean;
}

export interface AgentTOCProps {
  items: AgentTOCItem[];
  /** Smooth scroll offset (px) when jumping to a section. */
  scrollOffset?: number;
}

export function AgentTOC({ items, scrollOffset = 72 }: AgentTOCProps) {
  const { t } = useTranslation('scenes/apps');
  const ids = items.map((it) => it.id);
  const active = useScrollSpy(ids);

  const scrollToSection = useCallback(
    (sectionId: string) => {
      const el = document.getElementById(sectionId);
      if (!el) return;
      const scroller = findScrollableAncestor(el);
      if (scroller) {
        const offsetTop =
          el.getBoundingClientRect().top
          - scroller.getBoundingClientRect().top
          + scroller.scrollTop
          - scrollOffset;
        scroller.scrollTo({ top: offsetTop, behavior: 'smooth' });
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [scrollOffset],
  );

  return (
    <aside className="app-detail-agents__toc-wrap" aria-label={t('appDetail.agents.toc.label')}>
      <div className="app-detail-agents__toc-heading">{t('appDetail.agents.toc.heading')}</div>
      <NavigationList variant="plain">
        {items.map((item) => (
          <NavigationListItem
            key={item.key}
            active={active === item.id}
            meta={
              item.dirty ? (
                <span className="app-detail-agents__toc-dot" aria-hidden="true" />
              ) : undefined
            }
            onClick={() => scrollToSection(item.id)}
          >
            {item.label}
          </NavigationListItem>
        ))}
      </NavigationList>
    </aside>
  );
}

function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const idsKey = ids.join('|');

  useEffect(() => {
    const sectionIds = idsKey ? idsKey.split('|') : [];
    if (sectionIds.length === 0) return;
    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.length === 0) return;
        const visibleIds = new Set(
          entries.filter((e) => e.isIntersecting).map((e) => (e.target as HTMLElement).id),
        );
        if (visibleIds.size === 0) return;
        const next = sectionIds.find((id) => visibleIds.has(id));
        if (next) setActive(next);
      },
      {
        rootMargin: '-12% 0px -60% 0px',
        threshold: 0,
      },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [idsKey]);

  return active;
}

function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let cursor: HTMLElement | null = el.parentElement;
  while (cursor) {
    const style = getComputedStyle(cursor);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && cursor.scrollHeight > cursor.clientHeight) {
      return cursor;
    }
    cursor = cursor.parentElement;
  }
  return null;
}
