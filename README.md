[中文](README.zh-CN.md) | **English**

<div align="center">

![Sparo OS](./image/Sparo_title.png)

</div>
<div align="center">

[![Version](https://img.shields.io/badge/version-v0.1.0-blue?style=flat-square)](https://github.com/GCWing/Sparo-Agentic-OS/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/GCWing/Sparo-Agentic-OS/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/GCWing/Sparo-Agentic-OS/actions/workflows/ci.yml)
[![Website](https://img.shields.io/badge/Website-Sparo%20OS-E60012?style=flat-square)](https://gcwing.github.io/Sparo-Agentic-OS/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](https://github.com/GCWing/Sparo-Agentic-OS/blob/main/LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square)](https://github.com/GCWing/Sparo-Agentic-OS)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24c8db?style=flat-square)](https://tauri.app/)

Technical foundation derived from the upstream [GCWing/BitFun](https://github.com/GCWing/BitFun) project.
</div>

---

<div align="center">

### An Agentic OS built for the AI era

**It learns your habits and needs, builds applications tailored to you, operates your computer, keeps working for you, and understands you better over time.**

</div>

![Sparo OS Hero](./image/readme_hero.png)

---

## Introduction

Sparo OS is an operating system reimagined for the AI era. Where a traditional OS runs programs, Sparo OS orchestrates intelligent capabilities that understand intent, execute autonomously, and keep evolving.

You do not need to care about underlying structures such as sessions, workspaces, or context. In front of you is a single entry point, with almost zero barrier to getting started. You only state what you want, and the rest is handled by the system: it understands your habits, organizes tasks, carries context forward, schedules the right capabilities, and keeps working in the background until the job is done.

Whether you start directly from the desktop app or direct it remotely through your phone or bots, Sparo OS keeps working, keeps accumulating, and gradually adapts to your personal workflow.

---

## What It Does for You

Sparo OS understands your habits and needs, orchestrates the capabilities inside the system, and keeps getting your work done.

### Builds applications tailored to you

Sparo OS builds applications tailored to your real workflow—ones you can keep using and that keep evolving, rather than one-off artifacts. This intelligent app system is carried by three app forms:

| Form           | Positioning                       | Description                                                                                                                       |
| -------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Live App**   | Interactive generated apps         | The system generates the interface and capabilities on demand, giving you the interaction surface that best fits your workflow. They have persistent identity and state, and can keep evolving, being reused, and rolled back. |
| **Agent App**  | Autonomous execution-oriented apps | Settle your methods and workflows into reusable, dedicated agents, using conversation and task flow as the main carrier. Best suited for heavy-execution, light-interaction work. |
| **Bridge App** | Bridges for existing software       | Adds an operational layer on top of your existing GUI software, bringing legacy software into the same workflow.                  |

### Operates your computer

Sparo OS can see your screen and click through software. With screenshots and text-based locating, it can operate browsers, office software, and even legacy applications without open APIs, performing real cross-application actions on your behalf.

### Keeps working for you

Sparo OS gathers all work in progress into a unified Task Center: unified scheduling, parallel execution, and timed advancement. You can state what you want and walk away—it organizes tasks, dispatches the right agents, carries context forward, and keeps pushing the work toward completion.

### Understands you better over time

Sparo OS has persistent memory. It distills key points during conversations and, on a daily schedule, consolidates scattered records into long-term memory. Your role, preferences, collaboration habits, and project context are remembered for the long term—no need to explain them again and again. The more you use it, the more it fits you.

### Direct it from anywhere

Beyond the desktop, you can also direct Sparo OS remotely through your phone browser, Telegram, Feishu, WeChat, and more, with end-to-end encrypted mobile communication. When you are away, pair once via QR code to put the computer back home to work.

### A visible AI companion

A companion that lives on your desktop shows in real time what the system is doing: thinking, using tools, waiting for approval, or finished. Click a bubble to jump back to the matching task. With built-in looks and custom appearance packages, the AI running in the background becomes perceivable and controllable.

---

## Built-in Apps

Sparo OS's intelligent apps are first-class citizens, all accessible and manageable from the unified Apps hub. The system ships with ready-to-use apps across all three forms:

**Agent App (autonomous execution)**

| App        | Positioning                  | Description                                                                                                                   |
| ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Code**   | For software development     | Built around Agentic, Plan, Debug, and Review workflows, covering implementation, planning, troubleshooting, and code review. |
| **Cowork** | For office collaboration     | Suitable for organizing requirements, drafting content, and advancing day-to-day tasks and knowledge work.                    |
| **Design** | For design exploration       | Used for HTML prototypes, visual artifacts, and design collaboration scenarios.                                               |

**Live App (interactive generated)**

| App           | Positioning            | Description                                                                                                                  |
| ------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **PPT Live**  | AI deck creation        | Create an outline, generate designed slides, refine page content, preview, and export editable PPTX or shareable HTML.       |
| **Spark Board** | AI collaborative ideation | A collaborative AI canvas for sparking ideas, clustering rough notes, and turning selected notes into send-ready drafts.   |

**Bridge App (existing software bridge)**

| App               | Positioning           | Description                                                                                            |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------ |
| **Cursor Bridge** | Bridges the Cursor SDK | Run Cursor SDK agents from within Sparo OS against a local workspace or a Cursor Cloud repository.      |

---

## Dev Kit

> It grows on its own.

Sparo OS comes with built-in scene-specific Tools and other capabilities for you to build your own intelligent apps. It also supports external Skills, MCP (including MCP Apps), and custom Sub Agents as kits to build, debug, and extend your own intelligent apps. The system keeps growing as you plug in more capabilities.

---

## Platform Support

Built with Tauri, the project supports Windows, macOS, and Linux desktop, while also supporting mobile remote control through the phone browser, Telegram, Feishu, WeChat, and more.

---

## Quick Start

### Download and use

Download the latest desktop installer from [Releases](https://github.com/GCWing/Sparo-Agentic-OS/releases). After installation, configure your model and start using it.

### Build from source

**Prerequisites:**

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/)
- [Rust toolchain](https://rustup.rs/)
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (required for desktop development)

**Commands:**

```bash
# Install dependencies
pnpm install

# Run desktop in development mode
pnpm run desktop:dev

# Build desktop
pnpm run desktop:build
```

For repository conventions and development rules, see [AGENTS.md](./AGENTS.md).

---

## Contributing

We welcome great ideas and code, and we are highly open to AI-generated code.

**Contribution directions we care about most:**

1. Good ideas / creativity (features, interaction, visuals, etc.)—via Issues
2. Improving the Agent system and outcomes
3. Improving stability and foundational capabilities
4. Growing the ecosystem (Skills, MCP, LSP plugins, or better support for certain vertical development scenarios)

---

## Disclaimer

1. This project is a spare-time exploration and research effort toward next-generation human-machine collaboration, and is not a commercial profit-making project.
2. More than 99% of this project was built with Vibe Coding. Code issues and suggestions are welcome, and AI-assisted refactoring and optimization are encouraged.
3. This project depends on and references many open-source projects. Thanks to all open-source authors. **If your rights are affected, please contact us and we will address it.**

---
