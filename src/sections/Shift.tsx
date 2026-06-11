import { useState } from "react";
import type { CSSProperties } from "react";
import { SectionShell, Reveal } from "@/components/primitives";
import { useI18n } from "@/lib/i18n";

/** Distinct thin-line app glyphs — so the scattered tiles read as "software".
 *  They fade out as a tile warms toward red (differences dissolving into one). */
function AppGlyph({ i, size, fade }: { i: number; size: number; fade: number }) {
  const s = "rgba(26,27,30,0.5)";
  const glyphs = [
    <circle key="a" cx="12" cy="12" r="6" stroke={s} strokeWidth="1.7" />,
    <rect key="b" x="6" y="6" width="12" height="12" rx="3" stroke={s} strokeWidth="1.7" />,
    <path key="c" d="M12 5l7 12H5z" stroke={s} strokeWidth="1.7" strokeLinejoin="round" />,
    <g key="d" stroke={s} strokeWidth="1.7" strokeLinecap="round">
      <path d="M7 9h10M7 13h10M7 17h6" />
    </g>,
    <path key="e" d="M6 15l4-5 3 3 5-7" stroke={s} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />,
    <path key="f" d="M6 8h12v8a2 2 0 01-2 2H9l-3 3z" stroke={s} strokeWidth="1.7" strokeLinejoin="round" />,
  ];
  const g = Math.round(size * 0.6);
  return (
    <svg width={g} height={g} viewBox="0 0 24 24" fill="none" aria-hidden style={{ opacity: fade }}>
      {glyphs[i % glyphs.length]}
    </svg>
  );
}

/** deterministic pseudo-random in [0,1) */
function rand(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * A frozen convergence with real mass: a generous cloud of large cool-grey app
 * tiles fans out on the left, then narrows and aligns rightward — glyphs
 * dissolving — until it resolves into the single big red Sparo mark, the one
 * saturated focal point. One grey material, one motion, one red payoff.
 * Hover collapses the cloud into the one.
 */
const N = 14;
const ANCHOR_LEFT = 84; // % — the one Sparo mark, with a clear gap
const TRAIL = Array.from({ length: N }).map((_, i) => {
  const t = i / (N - 1); // 0 = far in the cloud, 1 = nearest the one
  const spread = 1 - t; // fans out on the left, converges on the right
  const r = Math.round(236 - 22 * t);
  const g = Math.round(238 - 19 * t);
  const b = Math.round(242 - 16 * t);
  return {
    t,
    left: 2 + t * 64 + (rand(i) * 2 - 1) * 5,
    y: (rand(i + 31) * 2 - 1) * (0.25 + spread) * 132,
    size: 46 + rand(i + 7) * 26 + t * 22,
    rot: (rand(i + 5) * 2 - 1) * spread * 13,
    color: `rgb(${r}, ${g}, ${b})`,
    glyphFade: Math.max(0, 1 - t * 1.35),
    opacity: 0.5 + 0.45 * t,
    depth: rand(i + 17),
  };
});

function ConvergenceField() {
  const [hover, setHover] = useState(false);
  const { t } = useI18n();

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative h-[clamp(300px,min(42vw,44vh),500px)] w-full"
    >
      {/* end annotations — name the two ends of the journey */}
      <span className="absolute left-[2%] top-[6%] font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
        {t.shift.many}
      </span>
      <span
        className="absolute top-[6%] whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.18em] text-red"
        style={{ left: `${ANCHOR_LEFT - 4}%` }}
      >
        {t.shift.one}
      </span>

      {/* a quiet ring that blooms under the one on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 rounded-full ring-1 ring-red/25 transition-all duration-500"
        style={{
          left: `${ANCHOR_LEFT}%`,
          width: hover ? 220 : 120,
          height: hover ? 220 : 120,
          transform: "translate(-50%, -50%)",
          opacity: hover ? 1 : 0,
        }}
      />

      {/* the many — a cloud of grey app tiles fanning out, converging right */}
      {TRAIL.map((d, i) => (
        <span
          key={i}
          aria-hidden
          className="tile absolute grid place-items-center rounded-[26%] ring-1 ring-ink/[0.05]"
          style={
            {
              width: d.size,
              height: d.size,
              top: "50%",
              left: hover ? `${ANCHOR_LEFT}%` : `${d.left}%`,
              backgroundColor: d.color,
              opacity: hover ? 0 : d.opacity,
              boxShadow: `0 ${18 + d.t * 18}px ${36 + d.t * 34}px -24px rgba(26,27,30,${0.26 + d.t * 0.16})`,
              transitionDelay: hover ? `${Math.round((1 - d.t) * 260)}ms` : `${Math.round(d.depth * 200)}ms`,
              transform: `translate(-50%, calc(-50% + ${hover ? 0 : d.y}px)) rotate(${hover ? 0 : d.rot}deg) scale(${hover ? 0.3 : 1})`,
            } as CSSProperties
          }
        >
          <AppGlyph i={i} size={d.size} fade={d.glyphFade} />
        </span>
      ))}

      {/* the one — the real Sparo mark, the single saturated focal point */}
      <img
        src="/logo/sparo-mark.png"
        alt="Sparo"
        className="tile absolute"
        style={{
          width: "clamp(92px, 10vw, 136px)",
          height: "clamp(92px, 10vw, 136px)",
          top: "50%",
          left: `${ANCHOR_LEFT}%`,
          objectFit: "contain",
          transform: `translate(-50%, -50%) scale(${hover ? 1.1 : 1})`,
          filter: "drop-shadow(0 30px 54px rgba(230,0,18,0.32))",
        }}
      />
    </div>
  );
}

export function Shift() {
  const { lang, t } = useI18n();
  return (
    <SectionShell id="overview" index="01" kicker={t.shift.kicker}>
      <Reveal>
        <h2 className="font-semibold leading-[1.04] tracking-[-0.04em] text-ink" style={{ fontSize: "clamp(40px,5.6vw,76px)" }}>
          {t.shift.titlePrefix}
          <span className="text-red">{t.shift.titleAccent}</span>
          {lang === "zh" ? "。" : "."}
        </h2>
      </Reveal>

      <Reveal delay={120}>
        <div className="mt-10">
          <ConvergenceField />
        </div>
      </Reveal>
    </SectionShell>
  );
}

export default Shift;
