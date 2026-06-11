import { Logo } from "./Logo";
import { GITHUB_URL, RELEASES_URL, ISSUES_URL } from "@/lib/links";
import { useI18n } from "@/lib/i18n";

export function Footer() {
  const { t } = useI18n();
  const userHrefs = ["#download", "#overview", "#system", "#evolve", "#everywhere"];

  return (
    <footer className="relative mt-8 overflow-hidden bg-ink text-white">
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-red" />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),transparent)]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -right-8 top-8 hidden font-semibold leading-none tracking-tight text-white/[0.025] md:block"
        style={{ fontSize: "clamp(112px, 18vw, 240px)" }}
      >
        Sparo
      </span>

      <div className="relative mx-auto grid max-w-6xl grid-cols-2 gap-x-8 gap-y-10 px-6 py-14 md:grid-cols-5 md:py-16">
        <div className="col-span-2 max-w-sm">
          <div className="flex items-center gap-3">
            <Logo size={28} />
            <span className="text-[17px] font-semibold tracking-tight text-white">Sparo OS</span>
          </div>
          <p className="mt-4 text-[14px] leading-relaxed text-white/62">
            {t.footer.taglineA}
            <br />
            {t.footer.taglineB}
          </p>
          <div className="mt-7 flex items-center gap-3 font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/36">
            <span className="h-px w-10 bg-red" aria-hidden />
            Personal Agentic OS
          </div>
        </div>

        <FooterCol
          title={t.footer.users}
          links={t.footer.userLinks.map((label, i) => ({ href: userHrefs[i], label }))}
        />
        <FooterCol
          title={t.footer.builders}
          links={[
            { href: "#system", label: "Agent App" },
            { href: "#system", label: "Live App" },
            { href: "#system", label: "Bridge App" },
          ]}
        />
        <FooterCol
          title={t.footer.contributors}
          links={[
            { href: GITHUB_URL, label: "GitHub", external: true },
            { href: RELEASES_URL, label: "Releases", external: true },
            { href: ISSUES_URL, label: "Issues", external: true },
          ]}
        />
      </div>
      <div className="relative border-t border-white/[0.08] bg-black/15">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-5 font-mono text-[11px] uppercase tracking-[0.14em] text-white/42 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Sparo · MIT License</span>
          <span className="flex items-center gap-2 text-white/54">
            <span className="node scale-75" aria-hidden />
            {t.footer.running}
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string; external?: boolean }[];
}) {
  return (
    <div className="border-l border-white/[0.08] pl-4 md:pl-5">
      <div className="mb-4 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.12em] text-white/38 sm:tracking-[0.18em]">
        {title}
      </div>
      <ul className="space-y-2.5">
        {links.map((l, i) => (
          <li key={`${l.href}-${i}`}>
            <a
              href={l.href}
              target={l.external ? "_blank" : undefined}
              rel={l.external ? "noreferrer" : undefined}
              className="group inline-flex items-center gap-2 text-[13px] font-medium text-white/68 transition-colors hover:text-white"
            >
              <span className="h-px w-3 bg-white/18 transition-colors group-hover:bg-red" aria-hidden />
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Footer;
