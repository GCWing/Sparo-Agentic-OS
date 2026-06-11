import { useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { SECTION_STAGE_CLASS } from "@/lib/siteStructure";

const GRID = "28px 28px";
// one ground for the whole hero: present in the centre, dissolving outward, so the
// words sit inside the field rather than on top of it
const GROUND = "radial-gradient(72% 68% at 50% 46%, #000 0%, #000 30%, transparent 82%)";
// a soft pool that follows the cursor, sharpening the dots it passes over
const CURSOR =
  "radial-gradient(190px 190px at calc(var(--mx,0.5) * 100%) calc(var(--my,0.5) * 100%), #000 0%, #000 36%, transparent 72%)";

/**
 * Hero — the positioning, stated plainly: a personal Agentic OS that makes
 * powerful AI usable by everyone. Text and ground are one plane: a single faint
 * dot-field is the canvas the whole hero lives in; the words sit inside it. The
 * field never moves, but where the cursor passes the dots sharpen, as if the
 * surface responds to you. The lone red seed below is where the system begins.
 */
export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { t } = useI18n();

  function onMove(e: React.MouseEvent) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", String((e.clientX - r.left) / r.width));
    el.style.setProperty("--my", String((e.clientY - r.top) / r.height));
  }

  return (
    <section
      id="top"
      ref={ref}
      onMouseMove={onMove}
      className={`${SECTION_STAGE_CLASS} relative grid place-items-center overflow-hidden px-6`}
      style={{ ["--mx" as string]: 0.5, ["--my" as string]: 0.5 }}
    >
      {/* the single ground — the field the words and the seed share */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(26,27,30,0.08) 1px, transparent 1.6px)",
          backgroundSize: GRID,
          backgroundPosition: "center",
          WebkitMaskImage: GROUND,
          maskImage: GROUND,
        }}
      />
      {/* the same field, igniting red under the cursor */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(230,0,18,0.55) 1px, transparent 1.6px)",
          backgroundSize: GRID,
          backgroundPosition: "center",
          WebkitMaskImage: CURSOR,
          maskImage: CURSOR,
        }}
      />
      {/* a whisper of red in the same field, gathered at the centre */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(230,0,18,0.16) 1px, transparent 1.6px)",
          backgroundSize: GRID,
          backgroundPosition: "center",
          WebkitMaskImage:
            "radial-gradient(26% 30% at 50% 58%, #000 0%, transparent 100%)",
          maskImage:
            "radial-gradient(26% 30% at 50% 58%, #000 0%, transparent 100%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center text-center">
        <span className="block text-[clamp(18px,2.4vw,28px)] font-medium tracking-[0.16em] text-slate2">
          {t.hero.eyebrow}
        </span>
        <h1 className="mt-3 select-none font-black leading-[1.06] tracking-[0.01em] text-ink">
          <span className="block text-[clamp(42px,7.6vw,94px)]">{t.hero.titleA}</span>
          <span className="block text-[clamp(42px,7.6vw,94px)]">
            {t.hero.titleBPrefix}
            <span className="text-red">{t.hero.titleBAccent}</span>
          </span>
        </h1>

        {/* the one action — the seed, grown into a button. The hero teaches one
            gesture: where the cursor passes, the field ignites red. The button
            speaks the same language: at rest a hairline pill with the red seed
            breathing inside; on hover the seed ignites the whole pill — red
            floods outward from the seed itself, the wordmark flips white and
            the arrow dips. Download is the system igniting, not a grey link. */}
        <a
          href="#download"
          className="group relative mt-11 inline-flex items-center gap-3 overflow-hidden rounded-full py-3 pl-5 pr-6 ring-1 ring-ink/15 outline-none transition-[box-shadow,transform] duration-300 hover:shadow-[0_22px_44px_-18px_rgba(230,0,18,0.5)] focus-visible:ring-2 focus-visible:ring-red/60 active:scale-[0.98]"
        >
          {/* ignition flood — a red disc growing out of the seed's position */}
          <span
            aria-hidden
            className="hero-cta-flood absolute inset-0 bg-red"
          />
          {/* the seed — breathing at rest, flipping white once the red takes over */}
          <span
            aria-hidden
            className="seed-breathe relative h-[14px] w-[14px] rounded-[5px] bg-red transition-colors duration-300 group-hover:bg-white"
            style={{
              backgroundImage:
                "linear-gradient(160deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0) 44%)",
            }}
          />
          <span className="relative text-[15px] font-medium tracking-[0.04em] text-ink transition-colors duration-300 group-hover:text-white">
            {t.hero.cta}
          </span>
          {/* the download arrow — dips toward the ground on ignition */}
          <svg
            className="relative -ml-1 text-ink/35 transition-all duration-300 group-hover:translate-y-[2.5px] group-hover:text-white"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path d="M12 4v10.5m0 0L7.5 10M12 14.5l4.5-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5.5 19.5h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </a>

        {/* one quiet line of fact under the action — credibility, not decoration */}
        <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.2em] text-faint">
          {t.hero.fact}
        </p>
      </div>
    </section>
  );
}

export default Hero;
