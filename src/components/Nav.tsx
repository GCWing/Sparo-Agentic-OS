import { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { GithubIcon } from "./icons";
import { GITHUB_URL } from "@/lib/links";
import { useI18n } from "@/lib/i18n";
import { CHAPTERS, NAV_CHAPTERS, NAV_HEIGHT } from "@/lib/siteStructure";
import type { ChapterId, NavChapterId } from "@/lib/siteStructure";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Nav — the page told again, one inch wide.
 *
 * The whole site is the story of one red seed, so the header owns exactly one
 * and lets it live the same life in miniature. At the top of the page it
 * rests as the full stop after the wordmark — "Sparo OS." — breathing
 * quietly. Start reading and it leaves home: a continuous playhead that
 * glides along the rail as you scroll, passing under each chapter link in
 * turn (never jumping — click a far link and it runs the whole rail through
 * every chapter in between). By the final chapter it has crossed the entire
 * header and merges into the download pill's own seed, which begins to ring:
 * the journey of the page, replayed between the logo and the button.
 *
 * Around it, only quiet bookkeeping: mono numerals before each label — the
 * section numerals at micro scale — ink once a chapter has been read, red
 * while it owns the screen, faint while it waits. Hovering a link sends the
 * seed ahead to preview the destination; it returns to where you actually
 * are. The download pill speaks the hero CTA's exact gesture — red ignition
 * flooding out of the seed on hover.
 */
export function Nav() {
  const { lang, t, toggleLang } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const [activeId, setActiveId] = useState<ChapterId | null>(null);

  const railRef = useRef<HTMLDivElement>(null);
  const seedRef = useRef<HTMLSpanElement>(null);
  const seatRef = useRef<HTMLSpanElement>(null);
  const pillDotRef = useRef<HTMLSpanElement>(null);
  const linkRefs = useRef(new Map<NavChapterId, HTMLAnchorElement>());
  const hoverIdx = useRef<number | null>(null);
  const applyRef = useRef<() => void>();

  const links = t.nav.links.map((n) => ({ ...n, id: n.href.slice(1) as NavChapterId }));

  useEffect(() => {
    const md = window.matchMedia("(min-width: 768px)");
    // rail anchors, in journey order: wordmark seat → 4 chapter links → pill seed
    let anchors: { x: number; y: number }[] = [];
    // where the reader is, as a continuous position along the journey:
    // 0 = resting at the logo, 1..4 = chapter links, 5 = inside the pill
    let progress = 0;
    let raf = 0;

    const measure = () => {
      const rail = railRef.current;
      const seat = seatRef.current;
      const pill = pillDotRef.current;
      if (!rail || !seat || !pill) return;
      const rr = rail.getBoundingClientRect();
      const center = (r: DOMRect) => ({
        x: r.left + r.width / 2 - rr.left,
        y: r.top + r.height / 2 - rr.top,
      });
      const pts = [center(seat.getBoundingClientRect())];
      for (const id of NAV_CHAPTERS) {
        const el = linkRefs.current.get(id);
        if (!el) return;
        const r = el.getBoundingClientRect();
        pts.push({ x: r.left + r.width / 2 - rr.left, y: r.bottom + 7 - rr.top });
      }
      pts.push(center(pill.getBoundingClientRect()));
      anchors = pts;
    };

    const readProgress = (): number => {
      const y = window.scrollY;
      const tops: number[] = [];
      for (const id of CHAPTERS) {
        const el = document.getElementById(id);
        if (!el) return 0;
        tops.push(el.getBoundingClientRect().top + y - NAV_HEIGHT);
      }
      if (tops[0] > 0 && y < tops[0]) return Math.max(0, y / tops[0]);
      for (let i = 0; i < CHAPTERS.length - 1; i++) {
        if (y < tops[i + 1]) return 1 + i + (y - tops[i]) / Math.max(1, tops[i + 1] - tops[i]);
      }
      return CHAPTERS.length;
    };

    const apply = () => {
      const seed = seedRef.current;
      if (!seed || anchors.length !== 6) return;
      if (!md.matches) {
        seed.style.opacity = "0";
        return;
      }
      const hover = hoverIdx.current;
      const p = hover !== null ? hover + 1 : progress;
      const i = Math.min(Math.floor(p), anchors.length - 2);
      const frac = Math.min(Math.max(p - i, 0), 1);
      const a = anchors[i];
      const b = anchors[i + 1];
      const x = a.x + (b.x - a.x) * frac;
      const y = a.y + (b.y - a.y) * frac;
      // over the last stretch the traveller dissolves into the pill's seed
      const fade = hover === null && p > 4.55 ? Math.max(0, (5 - p) / 0.45) : 1;
      seed.style.transform = `translate(${x - 2.5}px, ${y - 2.5}px)`;
      seed.style.opacity = String(fade);
      // only while resting at home does it breathe
      seed.classList.toggle("seed-breathe", hover === null && p < 0.02);
    };
    applyRef.current = apply;

    const onFrame = () => {
      raf = 0;
      setScrolled(window.scrollY > 8);
      // which chapter owns the middle of the screen right now
      const probe = window.innerHeight * 0.5;
      let current: ChapterId | null = null;
      for (const id of CHAPTERS) {
        const el = document.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top <= probe && r.bottom > probe) current = id;
      }
      setActiveId(current);
      progress = readProgress();
      apply();
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(onFrame);
    };
    const remeasure = () => {
      measure();
      onFrame();
    };

    remeasure();
    // webfonts settling moves every anchor
    document.fonts?.ready.then(remeasure);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", remeasure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", remeasure);
    };
  }, [lang]);

  const activeIdx = activeId ? CHAPTERS.indexOf(activeId) : -1;

  return (
    <header
      className={`sticky top-0 z-40 transition-[background-color,backdrop-filter] duration-300 ${
        scrolled ? "bg-white/70 backdrop-blur-md" : "bg-transparent"
      }`}
    >
      <div ref={railRef} className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2.5">
          <Logo size={26} />
          <span className="text-[16px] font-semibold tracking-tight text-ink">
            Sparo OS
            {/* the seed's home seat — the brand's full stop, vacated while reading */}
            <span className="relative ml-[3px] inline-block w-[5px]" aria-hidden>
              <span ref={seatRef} className="absolute bottom-px left-0 h-[5px] w-[5px]" />
            </span>
          </span>
        </a>

        <nav
          className="hidden items-center gap-7 text-[14px] md:flex"
          onMouseLeave={() => {
            hoverIdx.current = null;
            applyRef.current?.();
          }}
        >
          {links.map((n, i) => {
            const state = activeIdx === i ? "active" : activeIdx > i ? "read" : "unread";
            return (
              <a
                key={n.id}
                href={n.href}
                ref={(el) => {
                  if (el) linkRefs.current.set(n.id, el);
                }}
                onMouseEnter={() => {
                  hoverIdx.current = i;
                  applyRef.current?.();
                }}
                className="group flex items-baseline gap-1.5 py-1"
                aria-current={state === "active" ? "true" : undefined}
              >
                {/* the chapter numeral keeps the reader's ledger:
                    faint = unread, red = being read, ink = read */}
                <span
                  className={`font-mono text-[10px] leading-none tracking-[0.08em] transition-colors duration-500 ${
                    state === "active"
                      ? "text-red"
                      : state === "read"
                        ? "text-ink/45"
                        : "text-faint/60 group-hover:text-slate2"
                  }`}
                  aria-hidden
                >
                  0{i + 1}
                </span>
                <span
                  className={`transition-colors duration-300 ${
                    state === "active" ? "text-ink" : "text-slate2 group-hover:text-ink"
                  }`}
                >
                  {n.label}
                </span>
              </a>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 text-[14px] sm:gap-5">
          {/* language — a quiet mono switch in the page's micro-label voice */}
          <button
            type="button"
            onClick={toggleLang}
            aria-label={t.nav.languageLabel}
            title={t.nav.languageLabel}
            className="group relative font-mono text-[12px] tracking-[0.08em] text-slate2 transition-colors hover:text-ink"
          >
            {t.nav.languageText}
            <span className="absolute -bottom-0.5 left-0 h-px w-full origin-right scale-x-0 bg-current transition-transform duration-300 group-hover:origin-left group-hover:scale-x-100" />
          </button>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="text-slate2 transition-colors hover:text-ink"
          >
            <GithubIcon size={18} />
          </a>

          {/* download — the hero CTA's ignition gesture, at header scale: a
              hairline pill whose seed floods the whole pill red on hover */}
          <a
            href="#download"
            className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full py-2 pl-3.5 pr-4 font-medium ring-1 ring-ink/15 outline-none transition-[box-shadow,transform] duration-300 hover:shadow-[0_14px_28px_-12px_rgba(230,0,18,0.45)] focus-visible:ring-2 focus-visible:ring-red/60 active:scale-[0.97] sm:pl-4 sm:pr-5"
          >
            <span
              aria-hidden
              className="absolute left-[20px] top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-red transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[24]"
            />
            <span
              ref={pillDotRef}
              aria-hidden
              className="relative h-2 w-2 rounded-full bg-red transition-colors duration-300 group-hover:bg-white"
            >
              {/* the traveller has arrived — the pill's seed rings to greet it */}
              {activeId === "download" && (
                <span className="absolute inset-0 rounded-full border border-red motion-safe:animate-node-ring motion-reduce:hidden group-hover:hidden" />
              )}
            </span>
            <span className="relative text-ink transition-colors duration-300 group-hover:text-white">
              {t.nav.download}
            </span>
          </a>
        </div>

        {/* the one seed — full stop, playhead, and finally the button's pulse */}
        <span
          ref={seedRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 hidden h-[5px] w-[5px] rounded-full bg-red motion-reduce:transition-none md:block"
          style={{ opacity: 0, transition: `transform 0.55s ${EASE}, opacity 0.3s ease` }}
        />
      </div>

      {/* hairline — appears only once content actually slides under the bar */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-px bg-ink/[0.08] transition-opacity duration-300 ${
          scrolled ? "opacity-100" : "opacity-0"
        }`}
      />
    </header>
  );
}

export default Nav;
