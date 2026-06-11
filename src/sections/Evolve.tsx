import { useEffect, useRef, useState } from "react";
import { SectionShell, Reveal } from "@/components/primitives";
import type { EvolveArtifactKind as Kind } from "@/lib/contentTypes";
import { useI18n } from "@/lib/i18n";

/* ------------------------------------------------------------------ *
 * Evolve — it isn't a pile that gets taller; it's ONE thing that grows.
 * Left: a single body maturing like tree-rings — a fresh red ring laid
 * down each night, older rings settling to graphite, and a maturity word
 * that levels up (初识 → 强大). Right: six plots of potential (dashed,
 * faint — the same promise as the left's ghost coil) that get FORGED one
 * per night: the red perimeter traces itself shut, a thin-stroke glyph of
 * the artifact's nature draws in, and the memory that caused it dissolves
 * upward into the name of the thing it became. Then the card cools to a
 * plain white plate with an ink hairline — no floaty shadow, no halo.
 * ------------------------------------------------------------------ */

type Ev = { mem: string; kind: Kind; name: string };
const N = 6;

/* maturity that levels up — one relationship deepening, not a tally */

/* one continuous growth coil — a spiral that turns exactly once per night,
   centred on the core. We reveal it by angle, so each night = one full loop. */
const { path: SPIRAL_PATH, turnFrac: TURN_FRAC } = (() => {
  const cx = 62;
  const cy = 62;
  const a = 0; // grows straight out of the centre, so it winds around the core
  const rMax = 52;
  const thetaMax = N * 2 * Math.PI; // one turn per night
  const b = (rMax - a) / thetaMax;
  const per = 64; // segments per turn
  const segs = per * N;
  const pts: [number, number][] = [];
  for (let k = 0; k <= segs; k++) {
    const t = (k / segs) * thetaMax;
    const r = a + b * t;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  let total = 0;
  const cum = [0];
  for (let k = 1; k <= segs; k++) {
    total += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    cum.push(total);
  }
  const path = pts.map((p, k) => `${k === 0 ? "M" : "L"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  const turnFrac: number[] = [];
  for (let s = 0; s <= N; s++) turnFrac.push(cum[s * per] / total);
  return { path, turnFrac };
})();

function Moon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}
function Sun() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/* the artifact's nature, as a thin-stroke mark that draws itself at birth:
   app = a window, agent = a core with an orbit that never stops turning,
   tool = a machined hex component. Abstract, hairline, no icon noise. */
function KindGlyph({ kind, on }: { kind: Kind; on: boolean }) {
  const draw = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    pathLength: 1,
    className: "glyph-draw",
  };
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      aria-hidden
      className={`shrink-0 transition-colors duration-500 ${on ? "text-red" : "text-ink/35 group-hover:text-slate2"}`}
    >
      {kind === "app" && (
        <>
          <rect x="4" y="5" width="16" height="14" rx="3" {...draw} />
          <path d="M4 9.5h16" {...draw} />
        </>
      )}
      {kind === "agent" && (
        <>
          <circle cx="12" cy="12" r="2.4" {...draw} />
          <g className="orbit-turn">
            <path d="M19.5 12a7.5 7.5 0 1 1-3.2-6.15" {...draw} />
          </g>
        </>
      )}
      {kind === "tool" && <path d="M12 4l6.93 4v8L12 20l-6.93-4V8L12 4z" {...draw} />}
    </svg>
  );
}

export function Evolve() {
  const { lang, t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const touched = useRef(false);
  const [step, setStep] = useState(0);
  const EVENTS: Ev[] = t.evolve.events.map((e) => ({ ...e }));
  const KIND = t.evolve.kinds;
  const MATURITY = t.evolve.maturityWords;

  const run = () => {
    touched.current = true;
    if (timer.current) window.clearInterval(timer.current);
    setStep(0);
    timer.current = window.setInterval(() => {
      setStep((s) => {
        if (s >= N) {
          if (timer.current) window.clearInterval(timer.current);
          return s;
        }
        return s + 1;
      });
    }, 1500);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setStep(N);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || touched.current) return;
        io.disconnect();
        run();
      },
      { threshold: 0.35 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  const done = step >= N;
  const active = step - 1;
  const ev = active >= 0 ? EVENTS[active] : null;
  const word = MATURITY[Math.min(step, MATURITY.length - 1)];
  const nightLabel =
    lang === "zh" ? `${t.evolve.nightPrefix} ${step} ${t.evolve.nightSuffix}` : `${t.evolve.nightPrefix} ${step}`;

  return (
    <SectionShell id="evolve" index="03" kicker={t.evolve.kicker} compact>
      <div ref={ref} className="grid items-center gap-x-16 gap-y-14 lg:grid-cols-12">
        {/* left — the claim, and the ONE thing growing */}
        <Reveal className="lg:col-span-5">
          <h2
            className="font-semibold leading-[1.06] tracking-[-0.03em] text-ink"
            style={{ fontSize: lang === "zh" ? "clamp(32px,4.4vw,56px)" : "clamp(30px,3.3vw,44px)" }}
          >
            {t.evolve.titleA}
            <br />
            {t.evolve.titleBPrefix}
            <span className="text-red">{t.evolve.titleBAccent}</span>
            {lang === "zh" ? "，" : ","}
            <br />
            {t.evolve.titleC}
            {lang === "zh" ? "" : " "}
            <span className="text-red">{t.evolve.titleCAccent}</span>
            {t.evolve.titleCSuffix}
            {lang === "zh" ? "。" : "."}
          </h2>

          {/* the one body, maturing ring by ring — click it to regrow */}
          <div className="mt-9 flex items-center gap-6">
            <button
              type="button"
              onClick={run}
              aria-label={t.evolve.regrowLabel}
              title={t.evolve.regrowTitle}
              className="group relative shrink-0 cursor-pointer rounded-full outline-none transition-transform duration-300 hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-red/40"
              style={{ width: 124, height: 124 }}
            >
              <svg viewBox="0 0 124 124" className="h-full w-full">
                {/* the potential — the whole coil, barely there */}
                <path d={SPIRAL_PATH} fill="none" stroke="rgba(26,27,30,0.08)" strokeWidth="1.4" strokeLinecap="round" />
                {/* the growth — one continuous red coil; one full turn appears each night */}
                <path
                  d={SPIRAL_PATH}
                  fill="none"
                  stroke="#E60012"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  pathLength={1}
                  strokeDasharray="1"
                  style={{ strokeDashoffset: 1 - TURN_FRAC[step], transition: "stroke-dashoffset 0.9s cubic-bezier(0.22,1,0.36,1)" }}
                />
                <circle cx="62" cy="62" r="3" fill="#E60012" />
              </svg>
            </button>

            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
                {step === 0 ? t.evolve.maturity : `${t.evolve.maturity} · ${nightLabel}`}
              </div>
              <div key={step} className="animate-fade-up mt-1.5 text-[30px] font-semibold leading-none tracking-tight text-ink">
                {word}
              </div>
              <p className="mt-3 max-w-[15rem] text-[13.5px] leading-[1.6] text-slate2">{t.evolve.note}</p>
            </div>
          </div>
        </Reveal>

        {/* right — what that growth produced */}
        <Reveal delay={80} className="lg:col-span-7">
          <div className="flex items-end justify-between">
            <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
              <span className={done ? "text-red" : "text-slate2"}>{done ? <Sun /> : <Moon />}</span>
              {t.evolve.madeForYou}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate2">
              {step === 0 ? t.evolve.nightIn : nightLabel}
            </span>
          </div>

          {/* the cause, in words — which memory became which build */}
          <div className="mt-4 flex h-6 items-center text-[13px]">
            {ev ? (
              <p key={active} className="animate-fade-up flex items-center gap-2.5">
                <span className="text-slate2">
                  {lang === "zh" ? `${t.evolve.readPrefix}「${ev.mem}」` : `${t.evolve.readPrefix} ${ev.mem}`}
                </span>
                <span className="text-red">→</span>
                <span className="font-semibold tracking-tight text-ink">
                  {t.evolve.madePrefix} {ev.name}
                </span>
              </p>
            ) : (
              <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-faint">{t.evolve.ready}</span>
            )}
          </div>

          {/* the heroes — plots of potential, forged one per night */}
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {EVENTS.map((e, i) => {
              const shown = i < step;
              const on = i === active;
              return (
                <div
                  key={i}
                  className={`group relative flex min-h-[156px] flex-col overflow-hidden rounded-2xl border transition-[background-color,border-color,box-shadow] duration-500 ease-out ${
                    shown
                      ? `bg-white ${
                          on
                            ? "border-red/[0.25] shadow-[inset_0_0_0_1px_rgba(230,0,18,0.04),0_1px_2px_rgba(26,27,30,0.035)] hover:border-red/[0.36] hover:shadow-[inset_0_0_0_1px_rgba(230,0,18,0.10),0_1px_2px_rgba(26,27,30,0.04)]"
                            : "border-ink/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7),0_1px_2px_rgba(26,27,30,0.035)] hover:border-ink/[0.16] hover:shadow-[inset_0_0_0_1px_rgba(230,0,18,0.05),0_1px_2px_rgba(26,27,30,0.04)]"
                        }`
                      : "border-transparent"
                  }`}
                >
                  {shown && (
                    <span
                      aria-hidden
                      className={`pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-500 group-hover:opacity-100 ${
                        on ? "bg-red/35" : "bg-ink/[0.14]"
                      }`}
                    />
                  )}
                  {/* unborn — a plot of potential, like the left's ghost coil */}
                  {!shown && (
                    <span aria-hidden className="absolute inset-0 grid place-items-center rounded-2xl border border-dashed border-ink/[0.09]">
                      <span className="font-mono text-[11px] tabular-nums text-ink/[0.14]">{String(i + 1).padStart(2, "0")}</span>
                    </span>
                  )}

                  {shown && (
                    <>
                      {/* birth — the red perimeter traces itself shut, then cools away */}
                      <svg aria-hidden className="pointer-events-none absolute -inset-px h-[calc(100%+2px)] w-[calc(100%+2px)]">
                        <rect
                          x="1"
                          y="1"
                          rx="15"
                          style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }}
                          fill="none"
                          stroke="#E60012"
                          strokeWidth="1.5"
                          pathLength={1}
                          className="forge-trace"
                        />
                      </svg>

                      {/* chrome strip — each artifact reads as a small piece of software */}
                      <div className="flex items-center justify-between border-b border-ink/[0.045] px-4 pb-2.5 pt-3.5">
                        <span className="flex items-center gap-2">
                          <KindGlyph kind={e.kind} on={on} />
                          <span
                            className={`animate-fade-up font-mono text-[10px] uppercase tracking-[0.18em] transition-colors duration-500 ${on ? "text-red" : "text-faint group-hover:text-slate2"}`}
                            style={{ animationDelay: "0.25s" }}
                          >
                            {KIND[e.kind].en}
                          </span>
                        </span>
                        {on ? (
                          <span
                            className="animate-fade-up flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-red"
                            style={{ animationDelay: "0.35s" }}
                          >
                            <span className="h-1 w-1 rounded-full bg-red" style={{ animation: "node-breathe 1.6s ease-in-out infinite" }} />
                            {t.evolve.tonight}
                          </span>
                        ) : (
                          <span className="animate-fade-up font-mono text-[10px] tabular-nums text-ink/[0.18] transition-colors duration-500 group-hover:text-ink/30">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                        )}
                      </div>

                      {/* the memory dissolves into the thing it became, anchored low */}
                      <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
                        <div className="mt-auto">
                          <div className="grid">
                            <span className="mem-ghost col-start-1 row-start-1 self-end text-[12.5px] leading-snug text-slate2">
                              {lang === "zh" ? `「${e.mem}」` : e.mem}
                            </span>
                            <span className="name-resolve col-start-1 row-start-1 self-end text-[19px] font-semibold leading-tight tracking-tight text-ink">
                              {e.name}
                            </span>
                          </div>
                          <div className="animate-fade-up mt-1.5 text-[13px] leading-snug text-slate2" style={{ animationDelay: "0.8s" }}>
                            {KIND[e.kind].note}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </SectionShell>
  );
}

export default Evolve;
