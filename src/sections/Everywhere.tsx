import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { SectionShell, Display, Reveal } from "@/components/primitives";
import type { DeviceKey } from "@/lib/contentTypes";
import { useI18n } from "@/lib/i18n";

/* ------------------------------------------------------------------ *
 * Everywhere — argued from first principles, drawn as one object.
 *
 * A device is not an assistant; it is only a body the one mind borrows
 * for a moment. Earlier drafts placed the logo inside each device, but a
 * raster mark floating over flat line-art is a second visual language —
 * it reads as a sticker. The honest version keeps one language: the line.
 *
 * The red line IS the mind. Every body — watch, glasses, earphones,
 * phone, laptop — is drawn in the same brand red, and the hand-off is
 * told entirely by the ink: the old body's strokes retract while the new
 * body's strokes draw in, one continuous line of ink flowing from shape
 * to shape. No badge, no halo — the red never leaves, it just moves.
 * ------------------------------------------------------------------ */

const L = {
  fill: "none",
  stroke: "rgba(230,0,18,0.82)",
  strokeWidth: 2.2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  /* normalise every shape's length so the draw-on animation is one rule */
  pathLength: 1,
} as const;

/* Each body is one thin line-drawing on a shared 240×240 field, centred on
 * (120,120) so the constant red core sits at the same point in every one. */
const Frame = ({ children }: { children: ReactElement | ReactElement[] }) => (
  <svg viewBox="0 0 240 240" className="absolute inset-0 h-full w-full" aria-hidden>
    {children}
  </svg>
);

function WatchArt() {
  return (
    <Frame>
      <path d="M99 84 L103 50 H137 L141 84" {...L} />
      <path d="M99 156 L103 190 H137 L141 156" {...L} />
      <rect x="84" y="82" width="72" height="76" rx="20" {...L} />
      <path d="M156 110 h7 v20 h-7" {...L} />
    </Frame>
  );
}
function GlassesArt() {
  // Smart glasses: two distinct lenses + bridge; the seed sits between them.
  return (
    <Frame>
      <circle cx="76" cy="120" r="33" {...L} />
      <circle cx="164" cy="120" r="33" {...L} />
      <path d="M109 114 Q120 106 131 114" {...L} />
      <path d="M43 116 C35 111 33 101 39 94" {...L} />
      <path d="M197 116 C205 111 207 101 201 94" {...L} />
    </Frame>
  );
}
function EarphonesArt() {
  return (
    <Frame>
      <path d="M62 134 C62 82 88 56 120 56 C152 56 178 82 178 134" {...L} />
      <rect x="50" y="128" width="26" height="54" rx="13" {...L} />
      <rect x="164" y="128" width="26" height="54" rx="13" {...L} />
    </Frame>
  );
}
function PhoneArt() {
  return (
    <Frame>
      <rect x="78" y="40" width="84" height="160" rx="18" {...L} />
      <path d="M106 190 h28" {...L} />
    </Frame>
  );
}
function LaptopArt() {
  return (
    <Frame>
      <rect x="56" y="72" width="128" height="92" rx="6" {...L} />
      <path d="M44 164 H196 L208 190 H32 Z" {...L} />
    </Frame>
  );
}

type Device = { key: DeviceKey; zh: string; en: string; sense: string; line: string; Art: () => ReactElement };

/* the order the mind moves through — wrist, eyes, ears, pocket, desk */
const DEVICE_ARTS: Record<DeviceKey, () => ReactElement> = {
  watch: WatchArt,
  glasses: GlassesArt,
  earphones: EarphonesArt,
  phone: PhoneArt,
  computer: LaptopArt,
};

export function Everywhere() {
  const { lang, t } = useI18n();
  /* prev is the body the ink is currently leaving — it undraws while the
     active one draws, so the hand-off reads as one line of ink moving */
  const [step, setStep] = useState({ active: 0, prev: -1 });
  const active = step.active;
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);
  const DEVICES: Device[] = t.everywhere.devices.map((d) => ({
    ...d,
    Art: DEVICE_ARTS[d.key],
  }));

  useEffect(() => {
    reduced.current = !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (paused || reduced.current) return;
    const id = window.setInterval(() => setStep((s) => ({ active: (s.active + 1) % DEVICES.length, prev: s.active })), 3000);
    return () => window.clearInterval(id);
  }, [paused]);

  const d = DEVICES[active];

  return (
    <SectionShell id="everywhere" index="04" kicker={t.everywhere.kicker}>
      {/* the claim, then the first-principles reframing */}
      <div className="grid items-end gap-x-10 gap-y-6 lg:grid-cols-12">
        <Reveal className="lg:col-span-7">
          <Display size="clamp(34px, 4.8vw, 64px)">
            {t.everywhere.titleA}
            <br />
            {t.everywhere.titleBPrefix}
            <span className="h-live">{t.everywhere.titleBAccent}</span>
            {lang === "zh" ? "。" : "."}
          </Display>
        </Reveal>
        <Reveal delay={80} className="lg:col-span-5 lg:pb-2">
          <p className="text-[17px] leading-[1.7] text-slate2">
            {t.everywhere.bodyA}
            {t.everywhere.bodyB}
            <span className="text-ink">{t.everywhere.bodyBAccent}</span>
            {t.everywhere.bodyC}
            <span className="text-ink">{t.everywhere.bodyCAccent}</span>
            {lang === "zh" ? "。" : "."}
          </p>
        </Reveal>
      </div>

      {/* one object: a body that changes around a mind that doesn't */}
      <Reveal delay={80}>
        <div className="mt-5" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
          <div
            className="relative mx-auto"
            style={{ width: "clamp(156px, min(26vw, 23vh), 240px)", height: "clamp(156px, min(26vw, 23vh), 240px)" }}
          >
            {/* the bodies — the leaving one undraws, then the arriving one
               draws. Visibility is carried by the dashes alone; opacity only
               snaps (never fades), so a retired body can't ghost back in
               on top of the one being drawn. */}
            {DEVICES.map((dev, i) => {
              const on = i === active;
              const leaving = i === step.prev && !reduced.current;
              const Art = dev.Art;
              return (
                <div
                  key={dev.key}
                  aria-hidden
                  className={`absolute inset-0 ${on && !reduced.current ? "body-draw" : leaving ? "body-undraw" : ""}`}
                  style={{ opacity: on || leaving ? 1 : 0 }}
                >
                  <Art />
                </div>
              );
            })}
          </div>

          {/* the five bodies as a quiet rail — one unbroken line of memory, five stops */}
          <div className="relative mx-auto mt-5 flex max-w-xl items-start justify-between">
            <span aria-hidden className="absolute inset-x-1 top-[4px] h-px bg-ink/12" />
            {DEVICES.map((dev, i) => {
              const on = i === active;
              return (
                <button
                  key={dev.key}
                  type="button"
                  onClick={() => {
                    setStep((s) => (s.active === i ? s : { active: i, prev: s.active }));
                    setPaused(true);
                  }}
                  aria-pressed={on}
                  className="group relative flex flex-col items-center gap-2.5 outline-none"
                >
                  <span
                    className={`rounded-full transition-all duration-500 ${
                      on ? "h-2.5 w-2.5 bg-red shadow-[0_0_0_5px_rgba(230,0,18,0.12)]" : "h-2 w-2 bg-ink/20 group-hover:bg-ink/40"
                    }`}
                  />
                  <span
                    className={`max-w-[4.75rem] text-center text-[12px] font-semibold leading-tight tracking-tight transition-colors duration-300 sm:max-w-none sm:text-[13px] ${
                      on ? "text-ink" : "text-ink/40 group-hover:text-ink/70"
                    }`}
                  >
                    {dev.zh}
                  </span>
                </button>
              );
            })}
          </div>

          {/* one readout — only the body the mind is wearing now */}
          <div className="mt-5 grid items-end gap-x-8 gap-y-4 border-t border-ink/10 pt-5 sm:grid-cols-12">
            <div className="min-h-[44px] sm:col-span-7">
              <div key={d.key} className="animate-fade-up">
                <div className="flex items-center gap-2.5">
                  <span className="rounded-full bg-red px-2.5 py-0.5 text-[12px] font-medium text-white">{d.zh}</span>
                  <span className="font-mono text-[12px] tracking-[0.04em] text-faint">
                    {d.en} · {d.sense}
                  </span>
                </div>
                <p className="mt-2.5 text-[clamp(17px,1.8vw,21px)] font-semibold tracking-tight text-ink">{d.line}</p>
              </div>
            </div>
            <p className="text-[15px] leading-snug text-slate2 sm:col-span-5 sm:text-right">
              {t.everywhere.trailingA}
              <span className="text-ink">{t.everywhere.trailingAccent}</span>
              {lang === "zh" ? "。" : "."}
            </p>
          </div>
        </div>
      </Reveal>
    </SectionShell>
  );
}

export default Everywhere;
