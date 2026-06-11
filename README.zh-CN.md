**中文**  | [English](README.md)

<div align="center">

![Sparo OS](./image/Sparo_title.png)

</div>
<div align="center">

[![版本](https://img.shields.io/badge/version-v0.1.0-blue?style=flat-square)](https://github.com/GCWing/Sparo-Agentic-OS/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/GCWing/Sparo-Agentic-OS/ci.yml?branch=main&label=CI&style=flat-square)](https://github.com/GCWing/Sparo-Agentic-OS/actions/workflows/ci.yml)
[![官网](https://img.shields.io/badge/%E5%AE%98%E7%BD%91-Sparo%20OS-E60012?style=flat-square)](https://gcwing.github.io/Sparo-Agentic-OS/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](https://github.com/GCWing/Sparo-Agentic-OS/blob/main/LICENSE)
[![平台支持](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square)](https://github.com/GCWing/Sparo-Agentic-OS)
[![基于 Tauri](https://img.shields.io/badge/Built%20with-Tauri-24c8db?style=flat-square)](https://tauri.app/)

技术底座源自上游 [GCWing/BitFun](https://github.com/GCWing/BitFun) 项目。

</div>

---

<div align="center">

### 为 AI 时代打造的 Agentic OS

**它根据你的习惯和需求，为你定制专属应用、操作你的电脑、持续替你干活，越用越懂你。**

</div>

![Sparo OS Hero](./image/readme_hero_CN.png)

---

## 简介

Sparo OS 是一个为 AI 时代重做的操作系统。传统操作系统运行的是程序，Sparo OS 调度的是能理解意图、自主执行、持续演化的智能能力。

你不需要关心会话、工作区、上下文这些底层组织方式，面前只有一个入口，几乎 0 门槛就能开始。你只需要提出需求，剩下的交给系统：它会理解你的习惯，组织任务、衔接上下文、调度合适的能力，并在背后持续把事情做完。

无论你在桌面端直接发起，还是通过手机、机器人远程指挥，Sparo OS 都会持续工作、持续沉淀，逐步贴合你的个人流程。

---

## 它为你做什么

Sparo OS 理解你的习惯与需求，调度系统内的各项能力，持续替你把事做完。

### 为你定制专属应用

Sparo OS 按你的真实工作流，为你定制可长期使用、可持续演化的专属应用，而不是一次性的产物。这套智能应用系统由三种形态承载：

| 形态           | 定位         | 说明                                                                 |
| ------------ | ---------- | ------------------------------------------------------------------ |
| **Live App**   | 可交互生成式应用   | 由系统按需为你生成界面与能力，给你最贴合工作流的交互界面。具备持久身份与状态，可持续演化、复用与回滚。 |
| **Agent App**  | 自主执行型智能应用  | 把你的方法与流程沉淀成可复用的专属智能体，以对话与任务流为主要载体，适合重执行、轻交互的工作场景。       |
| **Bridge App** | 传统软件桥接应用   | 在你已有的 GUI 软件之上叠加操作能力，把存量软件接入同一套工作流。                    |

### 操作你的电脑

Sparo OS 看得见屏幕、点得动软件。借助截图与文字定位，它可以操作浏览器、办公软件，乃至没有开放接口的存量应用，替你完成跨软件的真实操作。

### 持续替你干活

Sparo OS 把所有正在进行的工作收进统一的任务中心：统一调度、并行执行、定时推进。你提完需求就可以离开，它会在背后组织任务、调度合适的智能体、衔接上下文，把事情持续推进到完成。

### 越用越懂你

Sparo OS 拥有持久记忆。它在对话过程中自动提炼要点，并每天定时把零散记录整理沉淀为长期记忆。你的角色、偏好、协作习惯、项目背景都会被长期记住，不用一遍遍重新交代——用得越久，它越贴合你。

### 随时随地指挥

桌面之外，你也可以通过手机浏览器、Telegram、飞书、微信等入口远程指挥，移动端通信端到端加密。人在外面，扫码配对即可调度家里的电脑继续干活。

### 看得见的 AI 伙伴

一个常驻桌面的智能伙伴会实时显示系统正在做什么：思考中、调用工具、等待确认、已完成。点一下气泡即可跳回对应任务。支持内置形象与自定义形象包，让后台运转的 AI 变得可感知、可掌控。

---

## 内置应用

Sparo OS 的智能应用是一等公民，全部可在统一的应用中心中访问与管理。系统已内置覆盖三种形态的开箱即用应用：

**Agent App（自主执行型）**

| 应用         | 定位     | 说明                                                  |
| ---------- | ------ | --------------------------------------------------- |
| **Code**   | 面向软件开发 | 由 Agentic、Plan、Debug、Review 等工作流组成，覆盖实现、规划、排障与代码审查。 |
| **Cowork** | 面向办公协作 | 适合整理需求、起草内容、推进日常事务与知识工作。                            |
| **Design** | 面向设计探索 | 用于 HTML 原型、视觉稿与设计协作场景。                              |

**Live App（可交互生成式）**

| 应用          | 定位     | 说明                                                       |
| ----------- | ------ | -------------------------------------------------------- |
| **PPT 工作台**   | AI 演示稿创作 | 生成大纲、生成设计页面、局部优化、演示预览，并导出可编辑 PPTX 或 HTML 演示稿。 |
| **灵感画布**     | AI 协作创意 | 激发想法、聚类粗略念头，并把选中的笔记整理成可直接发送的草稿。               |

**Bridge App（传统软件桥接）**

| 应用              | 定位         | 说明                                                |
| --------------- | ---------- | ------------------------------------------------- |
| **Cursor Bridge** | 桥接 Cursor SDK | 在 Sparo OS 中调度 Cursor SDK 智能体，针对本地工作区或 Cursor Cloud 仓库运行任务。 |

---

## 开发套件（Dev Kit）

> 它会自己成长。

Sparo OS 内置了面向场景的 Tools 等能力，供你构建自己的智能应用；同时支持接入外部 Skill、MCP（含 MCP App）、自定义 Sub Agent 等作为 Kit，用于构建、调试并扩展你自己的智能应用。系统会随着你接入的能力不断生长。

---

## 平台支持

项目基于 Tauri 构建，支持 Windows、macOS、Linux 全平台桌面端；同时支持通过手机浏览器、Telegram、飞书、微信等入口进行移动远程控制。

---

## 快速开始

### 直接下载使用

在 [Releases](https://github.com/GCWing/Sparo-Agentic-OS/releases) 页面下载最新桌面端安装包，安装后配置模型即可开始使用。

### 从源码构建

**前置依赖：**

- [Node.js](https://nodejs.org/)（推荐 LTS 版本）
- [pnpm](https://pnpm.io/)
- [Rust 工具链](https://rustup.rs/)
- [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)（桌面端开发需要）

**运行指令：**

```bash
# 安装依赖
pnpm install

# 以开发模式运行桌面端
pnpm run desktop:dev

# 构建桌面端
pnpm run desktop:build
```

仓库约定和开发规则请参阅 [AGENTS-CN.md](./AGENTS-CN.md)。

---

## 贡献

欢迎大家贡献好的创意和代码，我们对 AI 生成代码抱有最大的接纳程度。

**我们重点关注的贡献方向：**

1. 贡献好的想法 / 创意（功能、交互、视觉等），提交 Issue
2. 优化 Agent 系统和效果
3. 提升系统稳定性和完善基础能力
4. 扩展生态（Skill、MCP、LSP 插件，或对某些垂域开发场景的更好支持）

---

## 声明

1. 本项目为业余时间探索、研究构建下一代人机协同交互，非商用盈利项目。
2. 本项目 99%+ 由 Vibe Coding 完成，代码问题也欢迎指正，可通过 AI 进行重构优化。
3. 本项目依赖和参考了众多开源软件，感谢所有开源作者。**如侵犯您的相关权益请联系我们整改。**

---
