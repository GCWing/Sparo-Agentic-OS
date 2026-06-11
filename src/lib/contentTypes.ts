import type { NavChapterId } from "./siteStructure";

export type SystemCapabilityKind = "agent" | "live" | "bridge";
export type SystemSceneKey = "dev" | "research" | "deck" | "auto";
export type EvolveArtifactKind = "app" | "agent" | "tool";
export type DeviceKey = "watch" | "glasses" | "earphones" | "phone" | "computer";

type NavLinkCopy = {
  readonly href: `#${NavChapterId}`;
  readonly label: string;
};

type SystemSceneCopy = {
  readonly key: SystemSceneKey;
  readonly goal: string;
  readonly app: string;
};

type EvolveArtifactCopy = {
  readonly mem: string;
  readonly kind: EvolveArtifactKind;
  readonly name: string;
};

type DeviceCopy = {
  readonly key: DeviceKey;
  readonly zh: string;
  readonly en: string;
  readonly sense: string;
  readonly line: string;
};

export type SurfaceCopy = {
  readonly zh: string;
  readonly en: string;
  readonly platforms: string;
  readonly ready: boolean;
};

export type CopySchema = {
  readonly meta: {
    readonly title: string;
    readonly description: string;
  };
  readonly nav: {
    readonly links: readonly NavLinkCopy[];
    readonly download: string;
    readonly languageLabel: string;
    readonly languageText: string;
  };
  readonly hero: {
    readonly eyebrow: string;
    readonly titleA: string;
    readonly titleBPrefix: string;
    readonly titleBAccent: string;
    readonly cta: string;
    readonly fact: string;
  };
  readonly shift: {
    readonly kicker: string;
    readonly many: string;
    readonly one: string;
    readonly titlePrefix: string;
    readonly titleAccent: string;
  };
  readonly system: {
    readonly kicker: string;
    readonly titleA: string;
    readonly titleBPrefix: string;
    readonly titleBAccent: string;
    readonly collapse: string;
    readonly demo: string;
    readonly recording: string;
    readonly coming: string;
    readonly recordingComing: string;
    readonly playLabelPrefix: string;
    readonly playLabelSuffix: string;
    readonly scenes: readonly SystemSceneCopy[];
    readonly weekly: string;
  };
  readonly evolve: {
    readonly kicker: string;
    readonly titleA: string;
    readonly titleBPrefix: string;
    readonly titleBAccent: string;
    readonly titleC: string;
    readonly titleCAccent: string;
    readonly titleCSuffix: string;
    readonly regrowLabel: string;
    readonly regrowTitle: string;
    readonly maturity: string;
    readonly nightPrefix: string;
    readonly nightSuffix: string;
    readonly note: string;
    readonly madeForYou: string;
    readonly nightIn: string;
    readonly ready: string;
    readonly readPrefix: string;
    readonly madePrefix: string;
    readonly tonight: string;
    readonly kinds: Readonly<Record<EvolveArtifactKind, { readonly en: string; readonly note: string }>>;
    readonly maturityWords: readonly string[];
    readonly events: readonly EvolveArtifactCopy[];
  };
  readonly everywhere: {
    readonly kicker: string;
    readonly titleA: string;
    readonly titleBPrefix: string;
    readonly titleBAccent: string;
    readonly bodyA: string;
    readonly bodyB: string;
    readonly bodyBAccent: string;
    readonly bodyC: string;
    readonly bodyCAccent: string;
    readonly trailingA: string;
    readonly trailingAccent: string;
    readonly devices: readonly DeviceCopy[];
  };
  readonly cta: {
    readonly kicker: string;
    readonly titlePrefix: string;
    readonly titleAccent: string;
    readonly download: string;
    readonly github: string;
    readonly support: string;
    readonly license: string;
    readonly liveLabel: string;
    readonly now: string;
    readonly ready: string;
    readonly planned: string;
    readonly onwards: string;
    readonly surfaces: readonly SurfaceCopy[];
  };
  readonly footer: {
    readonly taglineA: string;
    readonly taglineB: string;
    readonly users: string;
    readonly builders: string;
    readonly contributors: string;
    readonly userLinks: readonly string[];
    readonly running: string;
  };
};
