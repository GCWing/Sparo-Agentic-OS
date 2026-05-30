# Live App 设计与生成 Playbook

> 这份 Playbook 用于**生成一个新的 Live App**。AI 在使用 `InitLiveApp` 工具创建骨架后，必须遵循本指南完成实现，以避免典型的 "AI 味" 产出。
>
> 维护或修改框架本身的代码请回到 `SKILL.md`，本文件只服务于"造一个具体的小应用"。

---

## 一、生成流程（必走）

### 1. 少问，默认决策（最多 3 个问题）

在动笔之前，只确认用户能自然回答、且会影响结果的事项；不要把实现细节转嫁给用户：

- **目的与受众**：这个小应用解决什么具体问题？谁会反复使用？
- **数据来源与隐私边界**：是否要读取工作区、访问外部网络、执行命令、处理用户文件？
- **设计参考**：有没有已存在的内置应用 / 截图 / 品牌色作为视觉锚点？没有也告诉我，我会建议参考最贴近的内置应用。
- **持久化**：哪些状态需要跨会话保留（写到 `app.storage`）？

`node.enabled`、权限实现、Tweaks、i18n、文件结构由 Studio 默认决策：no node、最小权限、zh-CN + en-US、必要时 Tweaks。

### 2. 找设计上下文（不要从零 mock）

按优先级取上下文：

1. 用户提供的截图 / 品牌资料 / 现成代码
2. `live_app/Demo/` 与 `bundles/live-apps/` 中**最贴近形态**的内置应用 —  — 直接 `ls` + `Read` 拿到它的 `style.css`、`index.html`，识别它的视觉语言（间距、圆角、卡片密度、配色）
3. `--sparo-`* 主题变量（见 SKILL.md 的"主题集成"章节） —  — 所有颜色都优先 `var(--sparo-xxx, fallback)`，并且只使用 SKILL.md 白名单里的有效变量

**从零生成是最后选择** —  — 它直接导致千篇一律的"AI 味"产出。

### 3. 先声明你的设计系统（写在 `style.css` 顶部注释中）

在写一行实际样式之前，先用注释明确以下"宪法"，并在整份 CSS 里贯彻：

```css
/* === Design System ===
 * Theme: <一句话描述视觉调性，比如 "克制的工具感，深色优先">
 * Palette:
 *   - dominant: var(--sparo-bg) / var(--sparo-text)
 *   - supporting: var(--sparo-bg-secondary), var(--sparo-border)
 *   - accent: var(--sparo-accent)  // 仅用于关键 CTA / 选中态
 * Typography:
 *   - heading: 600, 18-22px
 *   - body:    400, 13-14px
 *   - caption: 400, 11-12px, --sparo-text-muted
 * Radius: 8px (cards) / 4px (inputs)
 * Motif: <一种重复的视觉元素，例：图标统一放在 24×24 圆角容器里 / 标题左侧 3px 实心色块>
 * ===================== */
```

> **一个 motif 比十个零散装饰更有价值** —  — 选定后**全应用复用**，不要每个区块发明新的视觉元素。

### 4. 占位先行 → 早预览

第一次产出**不需要数据/不需要图标也不需要真实内容**：

- 字段用占位文本（"标题占位 / Section A / 12 项"）
- 图片用 `<div class="placeholder">` + 标注期望尺寸
- 图标用 1-2 个字母的圆形单色占位（不要硬画 SVG 插画）
- 数据用 `ui.js` 内的 fixture；复杂数据才单独写 `seed.json`

完成后立即让用户在 Toolbox 里运行一次，**收反馈再迭代** —  — 拿"junior designer 给 manager 演示"的姿态。

### 5. 验证（每次大改后跑一遍）

- `cargo build`（如果改到了 Rust 端）
- 在 Toolbox 里启动应用，分别截图 4 种状态：light + zh / light + en / dark + zh / dark + en
- 如截图已生成且视觉问题不明确，再用 review subagent 做一次 fresh-eyes 检查；不要为了常规小改强制 fork
- 检查清单见本文末"视觉 QA Checklist"

---

## 二、反 AI 味清单（强约束）

下列模式**默认禁用**，除非用户明确要求或上下文严格需要：


| 反模式                           | 替代方案                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| 默认蓝紫渐变 / Aurora 风背景           | 用 `var(--sparo-bg)` 或单色 + 一处微妙强调                                                                     |
| Emoji 当主图标                    | inline SVG 占位（描边图标），或 1-2 字母圆形容器                                                                      |
| 左侧色条 + 圆角卡片组合                 | 整张卡片同色边框 + 顶部细条；或仅靠留白与字重区分                                                                            |
| 标题下面加 1px / 2px accent 横线     | 用字重 + 字号 + 留白做层级；横线只在 section 分隔时使用且要全局一致                                                             |
| 硬画复杂插画 SVG                    | 占位框 + 显式标注 "Image: 256×160, 待用户提供素材"                                                                  |
| Inter / Roboto / Arial 兜底就完事  | `var(--sparo-font-sans)` 优先，fallback 写完整：`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| 全部色块/字号给同等视觉权重                | dominance：一个颜色占 60-70%，1-2 个 supporting，1 个 accent                                                    |
| 文字 < 12px / hit target < 32px | 任何可点击元素 ≥ 32px；正文 ≥ 13px；caption ≥ 11px                                                               |
| 每个 section 都用一种新的卡片样式         | 一个 motif 贯穿；不同区块用相同卡片，靠内容区分                                                                           |
| 用大量 stats / 装饰性图标填空白          | 留白本身就是设计；空白说明结构应被简化，不是被填满                                                                             |
| 圆角随心所欲（4 / 8 / 12 / 16 混用）    | 在设计系统里钉 1-2 个圆角档位，全应用统一                                                                               |
| 一上来就写 1500 行 ui.js            | 早提交早预览；功能成型后再分模块（参考 `live_app/Demo/git-graph` 的拆分）                                                     |


---

## 三、配色与字体（实操指引）

### 配色

1. **首选**：直接 `var(--sparo-*)` 系列，让小应用与宿主主题协同。
2. **变量有效性**：只使用 SKILL.md "主题集成"章节列出的宿主变量；`--sparo-surface`、`--sparo-card`、`--theme-bg`、`--color-primary` 等名字如果需要使用，必须先在 `:root` 定义为应用自己的 alias。
3. **fallback**：每个 `var()` 都带 fallback，用于导出为独立应用时仍可用。
4. **主题区分**：所有颜色都要在 light / dark 各测一次。可以利用 `[data-theme-type="light"]` 选择器做差异化覆写。
5. **辅助色板**（仅当用户明确需要"专属配色"时使用，否则默认走主题） —  — 参考下方 10 套从内容出发的配色：


| 主题感觉               | 主色        | 辅助        | 强调        | 适合的小应用  |
| ------------------ | --------- | --------- | --------- | ------- |
| Midnight Executive | `#1E2761` | `#CADCFC` | `#FFFFFF` | 商务 / 报表 |
| Forest & Moss      | `#2C5F2D` | `#97BC62` | `#F5F5F5` | 自然 / 笔记 |
| Coral Energy       | `#F96167` | `#F9E795` | `#2F3C7E` | 营销 / 活动 |
| Warm Terracotta    | `#B85042` | `#E7E8D1` | `#A7BEAE` | 文化 / 阅读 |
| Ocean Gradient     | `#065A82` | `#1C7293` | `#21295C` | 监控 / 数据 |
| Charcoal Minimal   | `#36454F` | `#F2F2F2` | `#212121` | 工具 / 极简 |
| Teal Trust         | `#028090` | `#00A896` | `#02C39A` | 健康 / 教育 |
| Berry & Cream      | `#6D2E46` | `#A26769` | `#ECE2D0` | 美食 / 生活 |
| Sage Calm          | `#84B59F` | `#69A297` | `#50808E` | 冥想 / 写作 |
| Cherry Bold        | `#990011` | `#FCF6F5` | `#2F3C7E` | 警示 / 任务 |


### 字体

```css
:root {
  --font-heading: var(--sparo-font-sans, -apple-system, 'Segoe UI', sans-serif);
  --font-body:    var(--sparo-font-sans, -apple-system, 'Segoe UI', sans-serif);
  --font-mono:    var(--sparo-font-mono, ui-monospace, SFMono-Regular, monospace);
}
```


| 元素           | 字号      | 字重                      |
| ------------ | ------- | ----------------------- |
| 应用主标题 / 模态标题 | 18-22px | 600                     |
| Section 标题   | 14-15px | 600                     |
| 正文           | 13-14px | 400                     |
| Caption / 辅助 | 11-12px | 400                     |
| 等宽（代码 / 数字）  | 12-13px | 400, `var(--font-mono)` |


### 间距与圆角

- 间距档位：`4 / 8 / 12 / 16 / 24 / 32`，挑 4 个用，不要全用。
- 圆角档位：`var(--sparo-radius)`（卡片）+ `var(--sparo-radius-lg)`（浮层）；输入框可固定 4-6px。
- 卡片内边距：紧凑 12px / 标准 16px / 宽松 20px —  — **全应用统一**。

---

## 四、变体优先：Tweaks 模式

> 灵感源：在最终用户那里，"一份代码服务多种偏好"才是 Live App 的天然优势。

### 何时用 Tweaks

- 颜色 / 密度 / 字号 / 圆角等"看上去合理的多种选择" —  — 做成可切换；
- 实验性布局 A/B；
- 语义命名（"专家模式" / "新手模式"）；
- 默认 4-6 项，不要堆超过 10 项（多了用户不会用）。

### 实现约定

1. **存储**：使用 `app.storage`，key 固定为 `tweaks`，结构是扁平 JSON。
  ```javascript
   const DEFAULT_TWEAKS = {
     density: 'standard',     // 'compact' | 'standard' | 'cozy'
     accent:  'theme',        // 'theme' | 'coral' | 'teal' | ...
     mono:    false,          // 主标题用等宽字体
   };

   async function loadTweaks() {
     const saved = await app.storage.get('tweaks');
     return { ...DEFAULT_TWEAKS, ...(saved || {}) };
   }

   async function setTweak(key, value) {
     const next = { ...current, [key]: value };
     current = next;
     await app.storage.set('tweaks', next);
     applyTweaks(next);
   }
  ```
2. **应用方式**：`applyTweaks` 把当前值写到 `<html data-tweak-density="compact">` 这种属性，CSS 用属性选择器响应 —  — 不要用 inline style 喷。
3. **UI 入口**：右下角悬浮齿轮按钮，点开一个小面板列出可调项；默认收起；面板标题就叫 "Tweaks"。
4. **i18n**：Tweak 的 label/option 文案也要进 i18n 表。
5. **不要放业务设置**：业务相关偏好（如 "过滤已读"）应放在主 UI 里，Tweaks 只服务"看起来怎么样"这一类纯外观选择。

---

## 五、占位策略（"placeholder > bad attempt"）


| 缺什么  | 怎么占位                                                      | 何时替换                     |
| ---- | --------------------------------------------------------- | ------------------------ |
| 图片   | `<div class="placeholder ph-img">256×160</div>` 灰底 + 尺寸文字 | 用户提供素材，或在 README 待补清单中登记 |
| 图标   | 1-2 字母圆形 mono 容器 / 描边线性 SVG                               | 用户给定品牌图标后替换              |
| 真实数据 | `seed.json` fixture / `app.ai.complete` mock 一段 demo      | 接入真实数据源后切换               |
| 复杂插画 | 占位框 + 文字标注 "Illustration TBD"                             | **不要**自己用 SVG 硬画         |
| 长文案  | "标题占位 · Headline placeholder"                             | 用户审过 wireframe 后再填真实文案   |


**记账**：默认在 `meta.json.description` 末尾列一个"待补素材清单"，让用户清楚哪些是占位；只有复杂交付才新增 `README.md`。

---

## 六、内容守则

1. **不要为填空白而加内容** —  — 空白是排版问题，不是内容问题。
2. **每个元素都要能回答"为什么在这里"** —  — 回答不了就删掉。
3. **加新 section / 新 page / 新功能前先问用户** —  — 你不比用户更懂他的目标。
4. **避免数据噪音**：无意义的统计数字、装饰性图标、伪造的 sparkline 都不要加。
5. **写文案要诚实**：宁可写"功能开发中"也不要伪造数据/截图骗用户。

---

## 七、与 Sparo OS 工具型 Live App 的契合度

绝大多数 Sparo OS 用户产出的小应用是**工具型**（git 视图 / 文件工具 / 计算器 / 轻量工作台…），它们的设计调性应当：

- 信息密度高、操作路径短
- 配色冷静（首选 `--sparo-`* 主题）
- 反对"营销页式大字 + 大图 + 渐变"
- 仿照 `gomoku` / `divination` / `git-graph` 的克制感

只有当用户明确说"我要做一个对外展示用的 / 灵感型 / 作品集型"小应用时，才考虑放飞视觉表达。

---

## 八、视觉 QA Checklist（每次产出后逐条检查）

- light / dark 两套主题都跑过，无白底飘黑字 / 黑底飘灰字
- CSS 中所有宿主主题变量都在 SKILL.md 白名单内；没有把未定义的 `--sparo-*`、`--theme-*`、`--color-*` 当作宿主变量使用
- 每个 `var(--sparo-*)` 都有 fallback；应用自定义 alias 已在 `:root` 明确定义
- zh-CN / en-US 切换无文本溢出 / 截断
- 所有可点击元素 hit target ≥ 32px
- 没有 12px 以下文字
- 长标题换行后装饰元素位置仍正确
- 边距 ≥ 12px，多列对齐一致
- 没有左侧色条 + 圆角卡片
- 没有标题下细装饰线（除非全局一致设计）
- 没有未替换的 emoji 主图标
- 没有 placeholder 文字遗留在生产代码里（"Lorem ipsum" / "TODO" / "占位"）
- `meta.json` 的 `i18n.locales` 至少包含 zh-CN 和 en-US
- `permissions.fs/shell/net` 是最小可用集（不滥用 `{workspace}` 或 `*`）
- Tweaks 默认值能让小应用立刻可用，不强迫用户先去调
- README 或 description 末尾登记了待补素材

---

## 九、参考产物

完整体现以上原则的内置/示例小应用：

- `bundles/live-apps/spark-board/` — 工具型工作台、主题切换 + i18n + 持久化范例
- `bundles/live-apps/ppt-live/` — 复杂应用拆模块、AI 辅助与导出流程范例
- `live_app/Demo/git-graph/` — 复杂应用拆模块的范例（`ui/components`, `ui/panels`, `ui/services`）
- `live_app/Demo/icon-design-system/` — 设计系统型应用范例

读它们的 `style.css` 顶部注释和 `meta.json` 的 `i18n` 块，是最快理解宿主视觉语言的方式。
