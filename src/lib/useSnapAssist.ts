import { useEffect } from "react";
import { NAV_HEIGHT, SECTION_STAGE_SELECTOR } from "@/lib/siteStructure";

/** Height of the sticky nav — a chapter's "best position" puts its top edge
 *  exactly below it (matches `scroll-padding-top` in index.css). */

/** Only assist when the rest position is within this distance of a boundary:
 *  ~20% of the viewport, capped so big screens don't get long-haul pulls. */
function assistZone() {
  return Math.min(170, window.innerHeight * 0.2);
}

/**
 * useSnapAssist — gentle, direction-aware chapter landing on free native scroll.
 *
 * Why not CSS scroll-snap: proximity/mandatory snap is direction-blind. Resting
 * anywhere inside the browser's generous snap zone pulls you back to the nearest
 * edge — so a small wheel tick away from a chapter edge gets undone, and
 * continuous scrolling feels stuck. The best-practice alternative (what editorial
 * full-screen sites hand-roll) is:
 *
 *   1. Never interfere while the user is scrolling — act only on scroll end.
 *   2. Direction-aware — only nudge FORWARD along the direction of travel,
 *      never pull back against it, so no rest position is ever "trapped".
 *   3. Small zone — only assist when the user stops just short of a boundary
 *      (~20% of viewport); stopping mid-chapter is respected as intentional.
 *   4. Interruptible — any wheel / touch / key input cancels the assist.
 *   5. Disabled for prefers-reduced-motion, and on stacked (narrow/short)
 *      layouts where chapters are taller than one screen.
 */
export function useSnapAssist() {
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px) and (min-height: 640px)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const supportsScrollEnd = "onscrollend" in window;

    let lastY = window.scrollY;
    let dir = 0; // 1 = down, -1 = up, 0 = unknown
    let assisting = false; // a programmatic settle is in flight
    let idleTimer: number | undefined;

    /** Chapter boundaries: each stage top aligned under the nav. */
    function boundaries(): number[] {
      return [...document.querySelectorAll<HTMLElement>(SECTION_STAGE_SELECTOR)].map((s) =>
        Math.round(s.getBoundingClientRect().top + window.scrollY - NAV_HEIGHT)
      );
    }

    function settle() {
      if (assisting || !desktop.matches || reduced.matches) return;
      if (dir === 0) return;
      const y = window.scrollY;
      const zone = assistZone();

      // The nearest boundary AHEAD in the direction of travel, within the zone.
      // Boundaries behind the travel direction are never considered — pulling
      // back against the user's motion is exactly what felt stuck.
      let target: number | null = null;
      for (const b of boundaries()) {
        const d = b - y;
        if (Math.abs(d) < 2) return; // already framed — nothing to do
        if (dir > 0 && d > 0 && d <= zone && (target === null || b < target)) target = b;
        if (dir < 0 && d < 0 && -d <= zone && (target === null || b > target)) target = b;
      }
      if (target === null) return;

      assisting = true;
      window.scrollTo({ top: target, behavior: "smooth" });
    }

    function onScrollEnd() {
      if (assisting) {
        // this scrollend belongs to our own settle animation — consume it
        assisting = false;
        return;
      }
      settle();
    }

    function onScroll() {
      const y = window.scrollY;
      if (y !== lastY) dir = y > lastY ? 1 : -1;
      lastY = y;
      if (!supportsScrollEnd) {
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(onScrollEnd, 160);
      }
    }

    /** Any real user input immediately hands control back to the user. */
    function onUserInput() {
      assisting = false;
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    if (supportsScrollEnd) window.addEventListener("scrollend", onScrollEnd);
    window.addEventListener("wheel", onUserInput, { passive: true });
    window.addEventListener("touchstart", onUserInput, { passive: true });
    window.addEventListener("keydown", onUserInput);

    return () => {
      window.clearTimeout(idleTimer);
      window.removeEventListener("scroll", onScroll);
      if (supportsScrollEnd) window.removeEventListener("scrollend", onScrollEnd);
      window.removeEventListener("wheel", onUserInput);
      window.removeEventListener("touchstart", onUserInput);
      window.removeEventListener("keydown", onUserInput);
    };
  }, []);
}
