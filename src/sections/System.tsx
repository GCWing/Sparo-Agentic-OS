import { useEffect, useRef, useState } from "react";
import { SectionShell, Reveal } from "@/components/primitives";
import type { SystemCapabilityKind as Kind, SystemSceneKey as SceneKind } from "@/lib/contentTypes";
import { useI18n } from "@/lib/i18n";

/* ------------------------------------------------------------------ *
 * System — shown, not told. At rest it's a lateral, perspective scene:
 * the left text leans right, the oversized light screen leans left, and
 * they converge. Press play and the screen straightens and fills the
 * stage while the goal list collapses away — a focused player. Close to
 * return. Every scene is a different app; set a scene's `video` for a clip.
 * ------------------------------------------------------------------ */

const APPS: Record<Kind, string> = { agent: "Agent", live: "Live", bridge: "Bridge" };
const ORDER: Kind[] = ["agent", "live", "bridge"];

type Scene = { key: SceneKind; goal: string; app: string; uses: Kind[]; video?: string; poster?: string };

const SCENE_USES: Record<SceneKind, Kind[]> = {
  dev: ["agent", "live", "bridge"],
  research: ["agent", "live", "bridge"],
  deck: ["agent", "live", "bridge"],
  auto: ["agent", "bridge"],
};

const bar = "rounded-full bg-ink/[0.10]";
const barFaint = "rounded-full bg-ink/[0.055]";

/** A distinct, abstract app screen per scenario — quiet greyscale shapes with one
 *  red accent — so each demo reads as a different product. Stands in for a clip. */
function SceneScreen({ kind }: { kind: SceneKind }) {
  const { t } = useI18n();

  if (kind === "dev") {
    return (
      <div className="flex h-full w-full flex-col gap-3.5 p-[4%]">
        <div className="flex items-center gap-2.5">
          <span className="h-3.5 w-20 rounded-md bg-red/15" />
          <span className={`h-3.5 w-14 ${barFaint}`} />
          <span className={`h-3.5 w-12 ${barFaint}`} />
        </div>
        <div className="flex flex-1 gap-4">
          <div className="flex w-9 flex-col items-end gap-2.5 pt-1">
            {[6, 5, 6, 5, 6, 4, 5, 6].map((w, i) => (
              <span key={i} className={`h-2.5 ${barFaint}`} style={{ width: w * 2.4 }} />
            ))}
          </div>
          <div className="flex flex-1 flex-col gap-3 pt-1">
            {[62, 48, 80, 38, 70, 30, 56].map((w, i) => (
              <span key={i} className={`h-3 ${i === 3 ? "rounded-full bg-red/70" : bar}`} style={{ width: `${w}%` }} />
            ))}
            <span className="mt-1 inline-block h-4 w-2 animate-pulse bg-red" />
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-lg bg-ink/[0.035] px-4 py-3">
          <span className="h-2 w-2 rounded-full bg-red" />
          <span className={`h-2.5 w-1/3 ${bar}`} />
          <span className={`h-2.5 w-1/5 ${barFaint}`} />
        </div>
      </div>
    );
  }
  if (kind === "research") {
    return (
      <div className="flex h-full w-full gap-5 p-[4%]">
        <div className="flex flex-1 flex-col gap-3">
          <span className={`h-5 w-2/3 ${bar}`} />
          <span className="mt-1 h-3 w-full rounded-full bg-ink/[0.07]" />
          {[96, 90, 72].map((w, i) => (
            <span key={i} className={`h-2.5 ${barFaint}`} style={{ width: `${w}%` }} />
          ))}
          <span className="inline-flex h-6 w-36 items-center rounded-md bg-red/12 px-2.5">
            <span className="h-2 w-2 rounded-full bg-red" />
          </span>
          {[88, 94, 64, 80].map((w, i) => (
            <span key={i} className={`h-2.5 ${barFaint}`} style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="flex w-[34%] flex-col gap-2.5 border-l border-ink/[0.07] pl-5">
          <span className="h-2.5 w-20 rounded-full bg-red/40" />
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="flex items-center gap-2.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-ink/20" />
              <span className={`h-2.5 flex-1 ${barFaint}`} />
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (kind === "deck") {
    return (
      <div className="flex h-full w-full flex-col gap-3.5 p-[4%]">
        <div className="flex flex-1 flex-col justify-between rounded-xl bg-ink/[0.025] p-5 ring-1 ring-ink/[0.05]">
          <div className="flex flex-col gap-2.5">
            <span className="h-4 w-1/2 rounded-full bg-red/70" />
            <span className={`h-2.5 w-3/4 ${bar}`} />
            <span className={`h-2.5 w-2/3 ${barFaint}`} />
          </div>
          <div className="flex items-end gap-2.5">
            {[40, 64, 30, 80, 52].map((h, i) => (
              <span key={i} className={`w-6 rounded-t ${i === 3 ? "bg-red/70" : "bg-ink/[0.12]"}`} style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
        <div className="flex gap-2.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={`h-11 flex-1 rounded-md ${i === 0 ? "bg-ink/[0.045] ring-1 ring-red/40" : "bg-ink/[0.03]"}`} />
          ))}
        </div>
      </div>
    );
  }
  // auto — a weekly flow that runs on its own
  return (
    <div className="flex h-full w-full flex-col justify-center gap-7 p-[5%]">
      <div className="flex items-center">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-1 items-center last:flex-none">
            <span
              className={`grid h-14 w-14 place-items-center rounded-2xl ring-1 ${
                i === 0 ? "bg-red/10 ring-red/40" : "bg-ink/[0.035] ring-ink/[0.07]"
              }`}
            >
              <span className={`h-3 w-3 rounded-[4px] ${i === 0 ? "bg-red" : "bg-ink/20"}`} />
            </span>
            {i < 3 && <span className="h-px flex-1 bg-ink/15" />}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">{t.system.weekly}</span>
        <span className="flex h-6 w-11 items-center rounded-full bg-red/15 px-1">
          <span className="ml-auto h-4 w-4 rounded-full bg-red" />
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-red/60" />
            <span className={`h-2.5 ${barFaint}`} style={{ width: `${70 - i * 16}%` }} />
          </span>
        ))}
      </div>
    </div>
  );
}

function DemoFrame({ scene, phase }: { scene: Scene; phase: "enter" | "leave" }) {
  return (
    <div className={`absolute inset-0 ${phase === "enter" ? "demo-enter" : "demo-leave"}`}>
      <div className="relative h-full w-full bg-white">
        <SceneScreen kind={scene.key} />
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/[0.04] to-transparent" />
      </div>
    </div>
  );
}

export function System() {
  const { lang, t } = useI18n();
  const [active, setActive] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const SCENES: Scene[] = t.system.scenes.map((s) => ({
    ...s,
    uses: SCENE_USES[s.key],
  }));
  const scene = SCENES[active];

  function select(i: number) {
    if (i === active) return;
    setLeaving(active);
    setActive(i);
  }

  useEffect(() => {
    if (leaving === null) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLeaving(null), 460);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [leaving, active]);

  // Esc collapses the player
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPlaying(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing]);

  return (
    <SectionShell id="system" index="02" kicker={t.system.kicker} className="overflow-hidden" compact>
      <div className="lg:flex lg:items-center">
        {/* left — concept + goals; on play it folds to a slim dot rail you can hover to switch */}
        <div className="relative z-30 lg:shrink-0">
          <Reveal>
            <div
              className={`transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                playing ? "lg:[transform:none]" : "origin-right lg:[transform:perspective(1700px)_rotateY(14deg)]"
              }`}
            >
              {/* heading — folds away in play mode */}
              <div
                className={`overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  playing ? "lg:max-h-0 lg:max-w-0 lg:opacity-0" : "lg:max-h-[220px] lg:max-w-[460px] lg:opacity-100"
                }`}
              >
                <h2 className="font-semibold leading-[1.08] tracking-[-0.03em] text-ink" style={{ fontSize: "clamp(30px,3.4vw,46px)" }}>
                  {t.system.titleA}
                  <br />
                  {t.system.titleBPrefix}
                  <span className="text-red">{t.system.titleBAccent}</span>
                  {lang === "zh" ? "。" : "."}
                </h2>
              </div>

              <ul className={`space-y-1 transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${playing ? "lg:mt-0" : "lg:mt-9"}`}>
                {SCENES.map((s, i) => {
                  const on = i === active;
                  return (
                    <li key={s.key}>
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-label={s.goal}
                        onClick={() => select(i)}
                        className="group relative flex items-center py-2.5 pr-1 text-left"
                      >
                        <span
                          className={`shrink-0 rounded-full transition-all duration-500 ${
                            on ? "h-2.5 w-2.5 bg-red shadow-[0_0_0_5px_rgba(230,0,18,0.12)]" : "h-2 w-2 bg-ink/20 group-hover:bg-ink/45"
                          }`}
                        />
                        {/* inline title — folds to zero width in play mode */}
                        <span
                          className={`ml-3.5 max-w-[min(76vw,360px)] overflow-hidden text-[clamp(17px,1.7vw,21px)] font-semibold tracking-tight transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] lg:whitespace-nowrap ${
                            playing ? "lg:ml-0 lg:max-w-0 lg:opacity-0" : "lg:max-w-[360px] lg:opacity-100"
                          } ${on ? "text-ink" : "text-ink/35 group-hover:text-ink/65"}`}
                        >
                          {lang === "zh" ? `「${s.goal}」` : s.goal}
                        </span>
                        {/* hover label — quick-switch hint while a demo fills the stage */}
                        <span
                          aria-hidden
                          className={`pointer-events-none absolute left-8 top-1/2 z-40 hidden -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-white opacity-0 shadow-[0_14px_34px_-12px_rgba(0,0,0,0.55)] transition-all duration-200 lg:block ${
                            playing ? "lg:group-hover:translate-x-0 lg:group-hover:opacity-100 lg:group-focus:translate-x-0 lg:group-focus:opacity-100" : ""
                          }`}
                        >
                          {lang === "zh" ? `「${s.goal}」` : s.goal}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Reveal>
        </div>

        {/* right — the oversized screen; leans left at rest, straightens & fills on play */}
        <Reveal delay={80} className="lg:min-w-0 lg:flex-1">
          <div
            className={`origin-left transition-[transform,padding,filter] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              playing
                ? "lg:pl-12 lg:[transform:none] lg:[filter:drop-shadow(0_44px_60px_rgba(26,27,30,0.2))]"
                : "lg:pl-10 lg:[transform:perspective(1700px)_rotateY(-16deg)_rotateX(2deg)_scale(1.05)] lg:[filter:drop-shadow(0_30px_46px_rgba(26,27,30,0.14))]"
            }`}
          >
            <div
              className={`overflow-hidden rounded-2xl border border-ink/[0.07] bg-white shadow-[0_30px_70px_-50px_rgba(26,27,30,0.3)] lg:shadow-none ${
                playing
                  ? ""
                  : "lg:[mask-image:linear-gradient(to_right,#000_68%,transparent_100%)] lg:[-webkit-mask-image:linear-gradient(to_right,#000_68%,transparent_100%)]"
              }`}
            >
              {/* window chrome — names the app generated for this goal */}
              <div className="flex items-center gap-3 border-b border-ink/[0.05] px-5 py-3.5">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-red" />
                  <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
                  <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
                </span>
                <span key={`${scene.key}-title`} className="animate-fade-up ml-1 text-[14px] font-semibold tracking-tight text-ink">
                  {scene.app}
                </span>
                {playing ? (
                  <button
                    type="button"
                    onClick={() => setPlaying(false)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[12px] font-semibold tracking-tight text-white shadow-[0_8px_20px_-10px_rgba(26,27,30,0.6)] transition-colors hover:bg-graphite"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    </svg>
                    {t.system.collapse}
                  </button>
                ) : (
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em] text-faint">{t.system.demo}</span>
                )}
              </div>

              {/* the screen — capped to the viewport height so the chapter still
                  fits one screen on shorter displays (width-driven 16:9 otherwise
                  grows too tall on wide-but-short screens) */}
              <div className="relative aspect-[16/9] max-h-[46vh] w-full overflow-hidden">
                {leaving !== null && <DemoFrame key={`leave-${SCENES[leaving].key}-${active}`} scene={SCENES[leaving]} phase="leave" />}
                <DemoFrame key={`enter-${scene.key}`} scene={scene} phase="enter" />

                {/* play seed — at rest */}
                {!playing && (
                  <button
                    type="button"
                    aria-label={`${t.system.playLabelPrefix}${scene.app}${t.system.playLabelSuffix}`}
                    onClick={() => setPlaying(true)}
                    className="group absolute left-1/2 top-1/2 grid h-[68px] w-[68px] -translate-x-1/2 -translate-y-1/2 place-items-center"
                  >
                    <span aria-hidden className="absolute inset-0 rounded-full ring-1 ring-red/40" style={{ animation: "node-ring 2.6s ease-out infinite" }} />
                    <span className="grid h-[58px] w-[58px] place-items-center rounded-full bg-red shadow-[0_18px_40px_-12px_rgba(230,0,18,0.55)] transition-transform duration-300 group-hover:scale-105">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="white" aria-hidden>
                        <path d="M8 5.5v13l11-6.5z" />
                      </svg>
                    </span>
                  </button>
                )}

                {/* playing — a real clip if present, else a tasteful standby */}
                {playing && scene.video && (
                  <video key={scene.video} className="absolute inset-0 h-full w-full bg-white object-cover" src={scene.video} poster={scene.poster} autoPlay controls playsInline />
                )}
                {playing && !scene.video && (
                  <div key={`${scene.key}-standby`} className="absolute inset-0 grid animate-fade-up place-items-center bg-white/55 backdrop-blur-[2px]">
                    <div className="flex flex-col items-center gap-4">
                      <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-faint">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red" />
                        {t.system.recording}
                      </span>
                      <span className="text-[clamp(18px,2vw,24px)] font-semibold tracking-tight text-ink">
                        {scene.app} · {t.system.coming}
                      </span>
                      <div className="mt-1 h-1 w-48 overflow-hidden rounded-full bg-ink/10">
                        <span className="block h-full w-1/3 rounded-full bg-red" style={{ animation: "shimmer 2.4s ease-in-out infinite" }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* footer — the three apps composed for this goal, lit per scene */}
              <div className="flex items-center justify-between border-t border-ink/[0.05] px-5 py-3.5">
                <div className="flex items-center gap-5">
                  {ORDER.map((k) => {
                    const used = scene.uses.includes(k);
                    return (
                      <span key={k} className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-[4px] transition-all duration-500 ${used ? "bg-red" : "bg-ink/[0.08] ring-1 ring-ink/10"}`} />
                        <span className={`font-mono text-[11px] uppercase tracking-[0.14em] transition-colors duration-500 ${used ? "text-ink/70" : "text-ink/25"}`}>
                          {APPS[k]}
                        </span>
                      </span>
                    );
                  })}
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">{t.system.recordingComing}</span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </SectionShell>
  );
}

export default System;
