import { SectionShell, Reveal, PrimaryButton, GhostLink } from "@/components/primitives";
import type { SurfaceCopy as Surface } from "@/lib/contentTypes";
import { GITHUB_URL, RELEASES_URL } from "@/lib/links";
import { useI18n } from "@/lib/i18n";

/* ------------------------------------------------------------------ *
 * Begin — the closing chapter. Left: the claim and the one action.
 *
 * Right — argued from first principles. The only question left before
 * the click is "does it run where I live — today?" That is a question
 * about TIME, not a feature grid. So no Ready/Planned checkbox matrix
 * and no icon chips: the answer is drawn as a single rollout line in
 * the page's own grammar — dots on a line, type beside them — the same
 * one-line-many-stops language as the Everywhere rail, turned vertical.
 * Shipped surfaces are red stations above a living NOW cursor, with the
 * red retracing the line down to the present; planned surfaces are
 * hollow stations on a dashed line below it; and the line runs past the
 * last stop and fades — the rollout has a direction, not an end.
 * (The devices already got their portrait as large line-art in chapter
 * 04 — here they only need to be stops, not pictures.)
 * ------------------------------------------------------------------ */

/* The route geometry: stations are 10px dots, so the spine runs at x = 4.5px;
   every absolutely-positioned piece of the line derives from it. */
const SPINE_X = "left-[4.5px]";
const DASH = "repeating-linear-gradient(to bottom, rgba(26,27,30,0.22) 0 4px, transparent 4px 10px)";

/** One stop on the line. Live stations are the page's red, already burning;
 *  planned ones are hollow, in place but not yet lit. */
function Station({ s, sr }: { s: Surface; sr: string }) {
  return (
    <div className="group relative flex items-center gap-4 py-[17px]">
      {/* hover wakes the stop, quietly: a floating wash, nothing moves */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-x-3 inset-y-1.5 rounded-xl bg-ink/[0.025] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      {/* the station itself — a dot sitting ON the spine, masking it */}
      <span
        className={`relative z-10 h-2.5 w-2.5 shrink-0 rounded-full transition-all duration-300 ${
          s.ready
            ? "bg-red shadow-[0_0_0_4px_rgba(230,0,18,0.10)] group-hover:shadow-[0_0_0_6px_rgba(230,0,18,0.15)]"
            : "bg-white ring-1 ring-ink/30 group-hover:ring-ink/50"
        }`}
      >
        <span className="sr-only">{sr}</span>
      </span>

      <span className="min-w-0">
        <span
          className={`whitespace-nowrap text-[16px] font-semibold tracking-tight transition-colors duration-300 ${
            s.ready ? "text-ink" : "text-ink/45 group-hover:text-ink/70"
          }`}
        >
          {s.zh}
        </span>
        {s.en !== s.zh && (
          <span className="ml-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">{s.en}</span>
        )}
      </span>

      <span
        className={`ml-auto text-right font-mono text-[12px] tracking-[0.01em] transition-colors duration-300 ${
          s.ready ? "text-slate2 group-hover:text-ink/75" : "text-faint/80 group-hover:text-slate2"
        }`}
      >
        {s.platforms}
      </span>
    </div>
  );
}

function RolloutLine() {
  const { t } = useI18n();
  const SURFACES: Surface[] = t.cta.surfaces.slice();
  const live = SURFACES.filter((s) => s.ready);
  const ahead = SURFACES.filter((s) => !s.ready);

  return (
    <div className="w-full text-left">
      <div className="flex items-baseline justify-between border-b border-ink/10 pb-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">{t.cta.support}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          <span className="text-red">{live.length}</span>
          {` / ${SURFACES.length} · ${t.cta.liveLabel}`}
        </span>
      </div>

      <div className="mt-2">
        {/* shipped — the part of the line already travelled. The hairline is
            there from the start; the red retraces it on reveal, down to NOW. */}
        <div className="relative">
          <span aria-hidden className={`absolute ${SPINE_X} top-7 -bottom-1 w-px bg-ink/10`} />
          <span aria-hidden className={`cta-spine-fill absolute ${SPINE_X} top-7 -bottom-1 w-px bg-red/60`} />
          {live.map((s) => (
            <Station key={s.en} s={s} sr={t.cta.ready} />
          ))}
        </div>

        {/* NOW — the cursor of the present, alive on the line */}
        <div className="relative flex items-center gap-3 py-2">
          <span aria-hidden className="node relative z-10 ml-px shrink-0" />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-red">{t.cta.now}</span>
          <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-red/25 to-transparent" />
        </div>

        {/* ahead — same stations, drawn in the grammar of the not-yet */}
        <div className="relative">
          <span aria-hidden className={`absolute ${SPINE_X} -top-1 bottom-0 w-px`} style={{ backgroundImage: DASH }} />
          {ahead.map((s) => (
            <Station key={s.en} s={s} sr={t.cta.planned} />
          ))}
          {/* the line runs past the last stop and fades — direction, not an end */}
          <div className="relative h-11">
            <span
              aria-hidden
              className={`absolute ${SPINE_X} top-0 h-full w-px`}
              style={{
                backgroundImage: DASH,
                WebkitMaskImage: "linear-gradient(to bottom, black, transparent)",
                maskImage: "linear-gradient(to bottom, black, transparent)",
              }}
            />
            <span className="absolute left-[26px] top-[13px] font-mono text-[10px] uppercase tracking-[0.18em] text-faint/90">
              {t.cta.onwards}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CTA() {
  const { lang, t } = useI18n();
  return (
    <SectionShell id="download" index="05" kicker={t.cta.kicker}>
      <div className="grid items-start gap-x-14 gap-y-12 lg:grid-cols-12">
        {/* left — the claim and the one action */}
        <Reveal className="lg:col-span-5 lg:pt-2">
          <h2
            className="font-semibold leading-[1.06] tracking-[-0.03em] text-ink"
            style={{ fontSize: "clamp(32px, 4.2vw, 54px)" }}
          >
            {t.cta.titlePrefix}
            <span className="text-red">{t.cta.titleAccent}</span>
            {lang === "zh" ? "。" : "."}
          </h2>
          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
            <PrimaryButton href={RELEASES_URL}>{t.cta.download}</PrimaryButton>
            <GhostLink href={GITHUB_URL}>{t.cta.github}</GhostLink>
          </div>
          <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.2em] text-faint">{t.cta.license}</p>
        </Reveal>

        {/* right — the rollout line */}
        <Reveal delay={90} className="lg:col-span-7">
          <RolloutLine />
        </Reveal>
      </div>
    </SectionShell>
  );
}

export default CTA;
