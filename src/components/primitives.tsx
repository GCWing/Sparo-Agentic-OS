import type { ReactNode } from "react";
import { SECTION_STAGE_CLASS } from "@/lib/siteStructure";
import { useReveal } from "@/lib/useReveal";

/** Editorial micro-label: red seed + mono uppercase tag. Used sparingly. */
export function Kicker({ children, tone = "dark" }: { children: ReactNode; tone?: "dark" | "light" }) {
  return (
    <div
      className={`inline-flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.22em] ${
        tone === "light" ? "text-white/55" : "text-slate2"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-red" />
      {children}
    </div>
  );
}

export function Eyebrow({ children, tone = "dark" }: { children: ReactNode; tone?: "dark" | "light" }) {
  return <Kicker tone={tone}>{children}</Kicker>;
}

/** A scroll-reveal wrapper. */
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

/**
 * SectionShell — the editorial frame shared by every section: a full-width
 * rule, a mono kicker on the left and an oversized faint section numeral on
 * the right. Content (including the big heading) is passed as children, so
 * each section can build its own asymmetric composition underneath.
 */
export function SectionShell({
  id,
  index,
  kicker,
  children,
  tone = "dark",
  className = "",
  compact = false,
}: {
  id?: string;
  index: string;
  kicker: string;
  children: ReactNode;
  tone?: "dark" | "light";
  className?: string;
  compact?: boolean;
}) {
  const light = tone === "light";
  return (
    <section id={id} className={`${SECTION_STAGE_CLASS} relative flex flex-col justify-center ${className}`}>
      {/* the inner block is what gets optically centred in the stage; its own
          vertical padding keeps content off the nav and the screen edge when a
          chapter is tall enough to grow past the viewport and scroll. */}
      <div className={`mx-auto w-full max-w-6xl px-6 ${compact ? "py-5 sm:py-6" : "py-6 sm:py-8"}`}>
        <div className={`border-t pt-7 ${light ? "border-white/15" : "border-ink/10"}`}>
          <Reveal>
            <div className="flex items-start justify-between">
              <Kicker tone={tone}>{kicker}</Kicker>
              <span
                className={`-mt-4 select-none font-semibold leading-none tracking-tight ${
                  light ? "text-white/10" : "text-ink/[0.06]"
                }`}
                style={{ fontSize: "clamp(44px, min(9vw, 10vh), 120px)" }}
                aria-hidden
              >
                {index}
              </span>
            </div>
          </Reveal>
          <div className="pt-6">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** The oversized editorial heading. `size` lets a section dial the scale down so
 *  its chapter still fits one screen without losing the editorial weight. */
export function Display({
  children,
  tone = "dark",
  className = "",
  size = "clamp(40px, 6.6vw, 88px)",
}: {
  children: ReactNode;
  tone?: "dark" | "light";
  className?: string;
  size?: string;
}) {
  return (
    <h2
      className={`font-semibold leading-[0.98] tracking-[-0.04em] ${tone === "light" ? "text-white" : "text-ink"} ${className}`}
      style={{ fontSize: size }}
    >
      {children}
    </h2>
  );
}

/** Primary action — solid ink pill with an arrow that advances on hover. */
export function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="group inline-flex items-center gap-3 rounded-full bg-ink py-3.5 pl-6 pr-3.5 text-[15px] font-medium text-white transition-colors hover:bg-graphite"
    >
      {children}
      <span className="grid h-7 w-7 place-items-center rounded-full bg-red text-white transition-transform duration-300 group-hover:rotate-0 group-hover:translate-x-0.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 12h14m0 0l-6-6m6 6l-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </a>
  );
}

/** Secondary action — text link with an animated underline. */
export function GhostLink({ href, children, tone = "dark" }: { href: string; children: ReactNode; tone?: "dark" | "light" }) {
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={`group inline-flex items-center gap-2 text-[15px] font-medium ${tone === "light" ? "text-white" : "text-ink"}`}
    >
      <span className="relative">
        {children}
        <span className="absolute -bottom-1 left-0 h-px w-full origin-right scale-x-0 bg-current transition-transform duration-300 group-hover:origin-left group-hover:scale-x-100" />
      </span>
    </a>
  );
}

/**
 * MockUI — a designed product placeholder. Reads as a real app (chrome,
 * sidebar, toolbar, content skeleton, one red accent) so the page looks
 * finished before a real screenshot is dropped in via `src`.
 */
export function MockUI({
  caption = "产品截图占位",
  ratio = "aspect-[16/10]",
  tone = "light",
  src,
  className = "",
}: {
  caption?: string;
  ratio?: string;
  tone?: "light" | "dark";
  src?: string;
  className?: string;
}) {
  const dark = tone === "dark";
  return (
    <div
      className={`overflow-hidden rounded-2xl ${
        dark ? "bg-graphite ring-1 ring-white/10" : "bg-white ring-1 ring-black/[0.06]"
      } shadow-[0_50px_120px_-50px_rgba(26,27,30,0.6)] ${className}`}
    >
      {/* title bar */}
      <div className={`flex items-center gap-2 px-4 py-3 ${dark ? "bg-white/[0.04]" : "bg-[#f6f7f9]"}`}>
        <span className="h-2.5 w-2.5 rounded-full bg-red/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/15" />
        <span className={`mx-auto translate-x-[-12px] rounded-md px-8 py-1 text-[11px] ${dark ? "bg-white/[0.05] text-white/40" : "bg-black/[0.04] text-faint"}`}>
          Sparo OS
        </span>
      </div>

      {src ? (
        <div className={`relative ${ratio} w-full`}>
          <img src={src} alt={caption} className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className={`relative ${ratio} flex w-full overflow-hidden ${dark ? "bg-ink" : "bg-white"}`}>
          {/* shimmer */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-1/3 z-10 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent"
            style={{ animation: "shimmer 4s ease-in-out infinite" }}
          />
          {/* sidebar */}
          <div className={`hidden w-[22%] flex-col gap-2.5 p-4 sm:flex ${dark ? "bg-white/[0.03]" : "bg-[#fafbfc]"}`}>
            <span className="h-2 w-2/3 rounded-full bg-red/70" />
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className={`h-2 rounded-full ${dark ? "bg-white/10" : "bg-ink/[0.07]"}`} style={{ width: `${85 - i * 9}%` }} />
            ))}
          </div>
          {/* main */}
          <div className="flex flex-1 flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <span className="h-5 w-24 rounded-md bg-red/10" />
              <span className={`h-5 w-16 rounded-md ${dark ? "bg-white/[0.06]" : "bg-ink/[0.05]"}`} />
              <span className={`ml-auto h-5 w-5 rounded-md ${dark ? "bg-white/[0.06]" : "bg-ink/[0.05]"}`} />
            </div>
            <div className="grid flex-1 grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={`flex flex-col gap-2 rounded-lg p-3 ${dark ? "bg-white/[0.04]" : "bg-[#f7f8fa]"} ${i === 0 ? "ring-1 ring-red/30" : ""}`}>
                  <span className={`h-2 rounded-full ${i === 0 ? "bg-red/60" : dark ? "bg-white/15" : "bg-ink/10"}`} style={{ width: "60%" }} />
                  <span className={`h-2 rounded-full ${dark ? "bg-white/10" : "bg-ink/[0.06]"}`} style={{ width: "90%" }} />
                  <span className={`h-2 rounded-full ${dark ? "bg-white/10" : "bg-ink/[0.06]"}`} style={{ width: "75%" }} />
                </div>
              ))}
            </div>
          </div>
          {/* caption chip */}
          <span className={`absolute bottom-3 right-3 rounded-full px-3 py-1 text-[11px] font-medium ${dark ? "bg-white/[0.06] text-white/45" : "bg-black/[0.04] text-faint"}`}>
            {caption}
          </span>
        </div>
      )}
    </div>
  );
}
