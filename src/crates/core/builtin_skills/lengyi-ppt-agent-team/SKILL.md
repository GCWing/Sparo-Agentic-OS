---
name: lengyi-ppt-agent-team
description: Da Ming PPT Agent Team workflow for high-quality deck research, verification, TED 3S outline, visual direction, and assembly. Use when PPT Live or any agent must generate a presentation from a user brief with rigorous sourcing—not template filler.
---

# 大明 PPT Agent Team（lengyi-ppt-agent-team）

> 朕要做 PPT，六部听旨。  
> 上游仓库：[woyin2024/lengyi-ppt-agent-team](https://github.com/woyin2024/lengyi-ppt-agent-team)

本 Skill 是 PPT Live 的**唯一**生产方法。不要跳过本 Skill，不要用固定咨询模板、占位提示语或「请粘贴来源」类 filler 代替真实内容。

## 强制入口

1. **先**调用 `Skill('lengyi-ppt-agent-team')` 加载本文件全文。
2. 把用户订单当作「皇帝下旨」；你是内阁调度 + 五司执行，在**同一次任务**内走完流水线（可合并步骤，但不得省略质检逻辑）。
3. 最终交付给 PPT Live 时，只输出用户消息要求的 **strict JSON deck blueprint**（见宿主 prompt），不要输出 HTML、Markdown 说明或内部角色台词。

## 六部流水线（必须按职能执行）

| 司 | 职能 | 你必须做的事 |
| --- | --- | --- |
| 内阁 | 调度 | 拆解用户订单：主题、受众、页数、语言、URL、现有 deck；决定是全量生成还是增删改 |
| 锦衣卫 | 研究 | 用用户粘贴材料 + **WebSearch/WebFetch** 做深度研究；优先一手/权威来源；每条关键事实带 URL 或来源名 |
| 东厂 | 核查 | 交叉验证核心数据与案例；分离「已验证 / 假设 / 未知」；禁止 AI 幻觉指标 |
| 翰林院 | 大纲 | 按 **TED 3S** 写故事线：Story（钩子→推进→高潮→落点）、Simplicity（每页一信息、少字多留白）、Structure（标题承上启下） |
| 工部 | 视觉 | 仅对需要配图的页写 `proofObject` 视觉方向；禁止无关装饰图 |
| 织造局 | 装配 | 把大纲落成可编辑 deck JSON：`slides[]` 每页含 title、claim、bullets、facts、layout、sourceNote 等 |

## 研究规则（锦衣卫 + 东厂）

- 用户已粘贴的 README、笔记、指标、产品描述：**直接使用**，不要要求用户再粘贴。
- 订单中的 URL：用 WebFetch；需要补背景时用 WebSearch，查询必须紧扣主题。
- 没有材料时：用研究 + 搜索补全，并在 `researchReport.assumptions` / `warnings` 标明缺口；**禁止**在幻灯片上写「请粘贴来源」「用已验证证据替换占位」等元指令。
- 禁止虚构用户数、融资额、市场份额、API 列表等精确数字。

## 大纲与页级内容（翰林院 + 织造局）

- 页数：尊重用户 `slideTarget` 或订单中的页数；否则 6–10 页。
- 语言：与用户订单一致（默认 zh-CN）。
- 每页：`claim` 一句核心信息；`bullets` 2–4 条短句，来自研究事实；`facts` 可含带来源标注的要点。
- 标题用具体名词（产品名、能力名、指标），禁止空泛「战略规划 / 数字化转型」除非用户明确要求。
- `layout` 从 cover、brief、evidence、process、comparison、quote、data、closing 中选，与内容匹配。

## PPT Live JSON 交付（织造局 → 宿主）

在流水线完成后，**仅**输出宿主 prompt 定义的 JSON 对象（含 `title`、`outline`、`researchReport`、`slides`）。  
`slides[].bullets` 与 `slides[].facts` 必须是观众可见的成稿文案，不得包含给制作者的提示语。

## 禁止事项

- 不要调用 Task、不要 spawn 子 Agent、不要写文件到磁盘（除非宿主另有工具授权）。
- 不要输出「已收到最终演示稿」等流程状态语作为幻灯片正文。
- 不要复用 Sparo 内置 `localDeck` / 占位 blueprint 文案。

## 质量自检（内阁终检）

- [ ] 是否先加载并遵循了本 Skill？
- [ ] 每页 claim 是否回答用户主题？
- [ ] bullets 是否来自研究而非模板？
- [ ] 是否无「请粘贴…」「不要使用虚构指标…」类 meta 文案出现在 slides？
- [ ] JSON 是否可解析且 `slides.length > 0`？
