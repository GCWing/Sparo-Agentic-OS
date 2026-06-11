import type { Config } from "tailwindcss";

/**
 * Palette extracted directly from the hero key visual:
 * neutral near-black ink on a light neutral gradient, with a single
 * bright vermilion red as the only accent. No navy, no soft brick red.
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1A1B1E", // near-black — headings, wordmark, dark surfaces
        graphite: "#303236", // secondary dark surface
        slate2: "#767B83", // muted gray — body / labels
        faint: "#9CA0A6", // mono technical labels
        red: {
          DEFAULT: "#E60012", // the single accent
          deep: "#C2000F", // hover / pressed
          soft: "#FF4438", // rare soft echo
        },
        cloud: "#F4F5F7", // light section fill
        surface: "#FFFFFF",
      },
      fontFamily: {
        sans: [
          "Inter",
          "Noto Sans SC",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Noto Sans SC",
          "PingFang SC",
          "Microsoft YaHei",
          "monospace",
        ],
      },
      letterSpacing: {
        hero: "0.06em",
      },
      boxShadow: {
        card: "0 1px 2px rgba(26,27,30,0.04), 0 12px 32px -16px rgba(26,27,30,0.12)",
        node: "0 6px 18px -6px rgba(230,0,18,0.45)",
      },
      borderColor: {
        DEFAULT: "rgba(26, 27, 30, 0.10)",
      },
      keyframes: {
        "node-ring": {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
        "spin-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
        "dash-flow": {
          to: { strokeDashoffset: "-24" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "node-ring": "node-ring 2.2s ease-out infinite",
        "spin-slow": "spin-slow 48s linear infinite",
        "dash-flow": "dash-flow 1.4s linear infinite",
        "fade-up": "fade-up 0.6s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
