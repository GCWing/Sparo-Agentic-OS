import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { CopySchema } from "@/lib/contentTypes";

export type Lang = "zh" | "en";

const STORAGE_KEY = "sparo-lang";

export const copy = {
  zh: {
    meta: {
      title: "Sparo OS - 让每个人都能简单使用强大的 AI 能力",
      description:
        "Sparo OS：让每个人都能简单使用强大 AI 能力的个人 Agentic OS。你只需说出目标，系统把 Agent、工具、记忆、软件连接和应用生成组织起来。",
    },
    nav: {
      links: [
        { href: "#overview", label: "转变" },
        { href: "#system", label: "系统" },
        { href: "#evolve", label: "演进" },
        { href: "#everywhere", label: "联动" },
      ],
      download: "下载",
      languageLabel: "Switch to English",
      languageText: "EN",
    },
    hero: {
      eyebrow: "个人智能体操作系统",
      titleA: "强大的 AI，",
      titleBPrefix: "从此",
      titleBAccent: "人人可用",
      cta: "下载 Sparo OS",
      fact: "开源 · MIT · Windows / macOS / Linux",
    },
    shift: {
      kicker: "转变 · 为你而生",
      many: "许多软件",
      one: "一个 · 为你而生",
      titlePrefix: "软件，",
      titleAccent: "为你而生",
    },
    system: {
      kicker: "系统 · 三个应用，达成一切",
      titleA: "一个系统，",
      titleBPrefix: "达成你的",
      titleBAccent: "一切",
      collapse: "收起演示",
      demo: "演示 · DEMO",
      recording: "演示录制中",
      coming: "即将上线",
      recordingComing: "录制中 · 即将上线",
      playLabelPrefix: "播放",
      playLabelSuffix: "演示",
      scenes: [
        { key: "dev", goal: "实现并调试这个功能", app: "开发工作台" },
        { key: "research", goal: "整理成一份研究报告", app: "研究工作台" },
        { key: "deck", goal: "做一份季度汇报", app: "汇报工作台" },
        { key: "auto", goal: "把每周汇总自动化", app: "自动化应用" },
      ],
      weekly: "每周一 08:00",
    },
    evolve: {
      kicker: "演进 · 与你一起演进",
      titleA: "用得越久，",
      titleBPrefix: "它越",
      titleBAccent: "懂你",
      titleC: "也越",
      titleCAccent: "强大",
      titleCSuffix: "",
      regrowLabel: "重新生长",
      regrowTitle: "点年轮，重新生长",
      maturity: "成熟度",
      nightPrefix: "第",
      nightSuffix: "夜",
      note: "每晚长出一圈，更懂你，也更强。",
      madeForYou: "它为你造的",
      nightIn: "入夜",
      ready: "入夜 · 准备开工",
      readPrefix: "读到你",
      madePrefix: "造了",
      tonight: "今夜",
      kinds: {
        app: { en: "Live App", note: "打开即用" },
        agent: { en: "Agent", note: "自动运行" },
        tool: { en: "Tool", note: "供 Agent 调用" },
      },
      maturityWords: ["初识", "熟悉", "默契", "懂你", "得力", "老练", "强大"],
      events: [
        { mem: "每天早上手动拼简报", kind: "app", name: "晨间简报" },
        { mem: "报销总要敲一遍发票", kind: "tool", name: "发票识别" },
        { mem: "邮件总按项目分类", kind: "agent", name: "邮件分流" },
        { mem: "对账常要换算汇率", kind: "tool", name: "汇率换算" },
        { mem: "时刻盯着项目进度", kind: "app", name: "项目看板" },
        { mem: "周会要汇总进展", kind: "agent", name: "周报助理" },
      ],
    },
    everywhere: {
      kicker: "如影随形 · 同一心智，万般形态",
      titleA: "你换的是屏幕，",
      titleBPrefix: "不是",
      titleBAccent: "它",
      bodyA:
        "设备从来不是助手，只是它的一块屏幕、一只耳朵、一双眼睛。在手表、眼镜、耳机、手机、电脑之间，你切换的不是五个助手，",
      bodyB: "而是",
      bodyBAccent: "它此刻借用的那具身体",
      bodyC: "——记忆、脾气、手上的活，",
      bodyCAccent: "始终是同一个",
      trailingA: "同一段记忆，",
      trailingAccent: "跟着你，不跟着设备",
      devices: [
        { key: "watch", zh: "手表", en: "Wrist", sense: "抬腕即达", line: "抬腕一瞥，它已把下一步安排好。" },
        { key: "glasses", zh: "眼镜", en: "Sight", sense: "所见即问", line: "看着眼前的世界，所见即可问。" },
        { key: "earphones", zh: "耳机", en: "Voice", sense: "在你耳边", line: "一句话说出口，答案只在耳边。" },
        { key: "phone", zh: "手机", en: "Pocket", sense: "随身入口", line: "路上想到什么，顺手就交给它。" },
        { key: "computer", zh: "电脑", en: "Desk", sense: "深度主场", line: "回到桌面，它接着刚才继续。" },
      ],
    },
    cta: {
      kicker: "开始 · 即刻启程",
      titlePrefix: "开启属于你的",
      titleAccent: "Agentic OS",
      download: "下载 Sparo OS",
      github: "查看 GitHub",
      support: "入口推进路线",
      license: "开源 · MIT",
      liveLabel: "入口已上线",
      now: "现在",
      ready: "已上线",
      planned: "规划中",
      onwards: "路线仍在延伸",
      surfaces: [
        { zh: "桌面", en: "Desktop", platforms: "Windows · macOS · Linux", ready: true },
        { zh: "浏览器", en: "Browser", platforms: "Chromium · Safari · Firefox", ready: true },
        { zh: "即时通讯", en: "Messaging", platforms: "微信 · 飞书 · Telegram", ready: true },
        { zh: "手机", en: "Mobile", platforms: "iOS · Android", ready: false },
        { zh: "穿戴", en: "Wearable", platforms: "手表 · 眼镜 · 耳机", ready: false },
      ],
    },
    footer: {
      taglineA: "让每个人都能简单使用强大的 AI 能力。",
      taglineB: "个人 Agentic OS · 点燃每个人的 AI 能力。",
      users: "用户",
      builders: "构建者",
      contributors: "贡献者",
      userLinks: ["下载 Sparo OS", "转变", "使用场景", "持续演进", "全设备联动"],
      running: "持续运行中",
    },
  },
  en: {
    meta: {
      title: "Sparo OS - Powerful AI, usable by everyone",
      description:
        "Sparo OS is a personal Agentic OS that makes powerful AI easy for everyone to use. Say the goal, and the system organizes agents, tools, memory, app connections, and generated apps around it.",
    },
    nav: {
      links: [
        { href: "#overview", label: "Shift" },
        { href: "#system", label: "System" },
        { href: "#evolve", label: "Evolve" },
        { href: "#everywhere", label: "Everywhere" },
      ],
      download: "Download",
      languageLabel: "切换到中文",
      languageText: "中",
    },
    hero: {
      eyebrow: "Personal Agentic OS",
      titleA: "Powerful AI,",
      titleBPrefix: "now ",
      titleBAccent: "for everyone",
      cta: "Download Sparo OS",
      fact: "Open source · MIT · Windows / macOS / Linux",
    },
    shift: {
      kicker: "Shift · Born for you",
      many: "Many apps",
      one: "One · born for you",
      titlePrefix: "Software, ",
      titleAccent: "born for you",
    },
    system: {
      kicker: "System · Three apps, any goal",
      titleA: "One system,",
      titleBPrefix: "for ",
      titleBAccent: "everything you want",
      collapse: "Close demo",
      demo: "Demo",
      recording: "Demo recording",
      coming: "Coming soon",
      recordingComing: "Recording · Coming soon",
      playLabelPrefix: "Play ",
      playLabelSuffix: " demo",
      scenes: [
        { key: "dev", goal: "Implement and debug this feature", app: "Development Workspace" },
        { key: "research", goal: "Turn this into a research report", app: "Research Workspace" },
        { key: "deck", goal: "Make a quarterly business review", app: "Deck Workspace" },
        { key: "auto", goal: "Automate the weekly summary", app: "Automation App" },
      ],
      weekly: "Mondays 08:00",
    },
    evolve: {
      kicker: "Evolve · Evolves with you",
      titleA: "The longer it runs,",
      titleBPrefix: "the more it ",
      titleBAccent: "knows",
      titleC: "the",
      titleCAccent: "stronger",
      titleCSuffix: " it gets",
      regrowLabel: "Regrow",
      regrowTitle: "Click the rings to regrow",
      maturity: "Maturity",
      nightPrefix: "Night",
      nightSuffix: "",
      note: "A new ring each night. More personal, more capable.",
      madeForYou: "Built for you",
      nightIn: "Nightfall",
      ready: "Nightfall · ready to build",
      readPrefix: "Read your habit:",
      madePrefix: "built",
      tonight: "Tonight",
      kinds: {
        app: { en: "Live App", note: "Open and use" },
        agent: { en: "Agent", note: "Runs for you" },
        tool: { en: "Tool", note: "Called by agents" },
      },
      maturityWords: ["First meet", "Familiar", "In sync", "Knows you", "Helpful", "Seasoned", "Powerful"],
      events: [
        { mem: "you assemble briefs every morning", kind: "app", name: "Morning Brief" },
        { mem: "expense claims need invoice typing", kind: "tool", name: "Invoice Reader" },
        { mem: "emails are sorted by project", kind: "agent", name: "Mail Router" },
        { mem: "reconciliation needs currency checks", kind: "tool", name: "FX Converter" },
        { mem: "project progress needs watching", kind: "app", name: "Project Board" },
        { mem: "weekly meetings need progress summaries", kind: "agent", name: "Weekly Report Assistant" },
      ],
    },
    everywhere: {
      kicker: "Everywhere · One mind, every body",
      titleA: "You change screens,",
      titleBPrefix: "not ",
      titleBAccent: "the mind",
      bodyA:
        "A device is not another assistant. It is only a screen, an ear, or a pair of eyes the same mind borrows for a moment. Across watch, glasses, earphones, phone, and computer, you are not switching between five assistants. ",
      bodyB: "You are switching ",
      bodyBAccent: "the body it is using right now",
      bodyC: " - while memory, tone, and unfinished work ",
      bodyCAccent: "stay the same",
      trailingA: "One memory, ",
      trailingAccent: "following you, not the device",
      devices: [
        { key: "watch", zh: "Watch", en: "Wrist", sense: "At a glance", line: "Raise your wrist. The next step is already arranged." },
        { key: "glasses", zh: "Glasses", en: "Sight", sense: "Ask what you see", line: "Look at the world in front of you, and ask from there." },
        { key: "earphones", zh: "Earphones", en: "Voice", sense: "In your ear", line: "Say it once, and the answer stays close." },
        { key: "phone", zh: "Phone", en: "Pocket", sense: "Always with you", line: "Think of something on the road and hand it over." },
        { key: "computer", zh: "Computer", en: "Desk", sense: "Deep work", line: "Return to the desk, and it continues from where you left off." },
      ],
    },
    cta: {
      kicker: "Begin · Start now",
      titlePrefix: "Start your own ",
      titleAccent: "Agentic OS",
      download: "Download Sparo OS",
      github: "View GitHub",
      support: "Rollout",
      license: "Open source · MIT",
      liveLabel: "surfaces live",
      now: "Now",
      ready: "Live",
      planned: "Planned",
      onwards: "The line keeps going",
      surfaces: [
        { zh: "Desktop", en: "Desktop", platforms: "Windows · macOS · Linux", ready: true },
        { zh: "Browser", en: "Browser", platforms: "Chromium · Safari · Firefox", ready: true },
        { zh: "Messaging", en: "Messaging", platforms: "WeChat · Feishu · Telegram", ready: true },
        { zh: "Mobile", en: "Mobile", platforms: "iOS · Android", ready: false },
        { zh: "Wearable", en: "Wearable", platforms: "Watch · Glasses · Earphones", ready: false },
      ],
    },
    footer: {
      taglineA: "Powerful AI, made simple for everyone.",
      taglineB: "Personal Agentic OS · Ignite AI for Everyone.",
      users: "For users",
      builders: "For builders",
      contributors: "For contributors",
      userLinks: ["Download Sparo OS", "Shift", "Use cases", "Continuous evolution", "Every device"],
      running: "Always on",
    },
  },
} as const satisfies Record<Lang, CopySchema>;

type Copy = (typeof copy)[Lang];

const I18nContext = createContext<{
  lang: Lang;
  t: Copy;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
} | null>(null);

function getInitialLang(): Lang {
  if (typeof window === "undefined") return "zh";
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (fromUrl === "zh" || fromUrl === "en") return fromUrl;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "zh" || stored === "en") return stored;
  return window.navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  const setLang = (next: Lang) => {
    setLangState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = copy[lang].meta.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = copy[lang].meta.description;
  }, [lang]);

  const value = useMemo(
    () => ({
      lang,
      t: copy[lang],
      setLang,
      toggleLang: () => setLang(lang === "zh" ? "en" : "zh"),
    }),
    [lang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
