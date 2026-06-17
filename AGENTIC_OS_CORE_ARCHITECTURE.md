# Sparo-Agentic-OS 内核架构审计

> 审计范围：`src/crates/core`, `src/crates/events`, `src/crates/transport`, `src/crates/ai-adapters`
> 产出日期：2026-06-17
> 2026-06-17 v1.1 修正：数值精确性审计通过（MAX_TURN_ROUND_RETRY_BUDGET=6, MAX_ROUND_RETRIES=2, MAX_IMAGE_BEARING_MESSAGE_ROUNDS=2, MAX_CONSECUTIVE_COMPRESSION_FAILURES=3），补充压缩 retry 机制

---

## 1. 总览

### 1.1 仓库规模

| 区域 | 说明 |
|------|------|
| `src/crates/core` | 平台无关核心业务逻辑：agent 运行时、session、工具、执行引擎、持久化、事件路由 |
| `src/crates/events` | 平台无关事件合约：`AgenticEvent`(31 变体)、`ToolEventData`(14 变体) |
| `src/crates/transport` | 传输适配层：`EventBus` 实现、`AgenticToTransportAdapter` trait |
| `src/crates/ai-adapters` | AI 供应商适配器：Tool call accumulator、SSE 适配、按模型供应商分发 |
| `src/apps/desktop` | Tauri 2 桌面 Shell：命令、capabilities、桌面集成 |
| `src/apps/cli` | CLI 终端面：命令解析、TUI 渲染 |
| `src/web-ui` | React 18 + TypeScript Web UI |

### 1.2 分析范围（按优先级）

1. 执行循环架构 — 最高优先级
2. 压缩系统
3. 事件总线
4. 协调层
5. 持久化层
6. Agent 注册与工具框架
7. 跨 crate 依赖图

---

## 2. 执行循环架构

### 2.1 涉及文件

| 文件 | 行数 | 角色 |
|------|------|------|
| `src/crates/core/src/agentic/execution/execution_engine.rs` | 1995 | 多轮主循环、压缩触发、图像裁剪、preempt 检查 |
| `src/crates/core/src/agentic/execution/round_executor.rs` | 701 | 单轮模型调用 + retry |
| `src/crates/core/src/agentic/execution/stream_processor.rs` | 1160 | SSE 流处理、tool call 分派 |
| `src/crates/core/src/agentic/execution/types.rs` | ~500 | 执行类型定义、tool_result content 抽帧 |
| `src/crates/ai-adapters/src/tool_call_accumulator.rs` | 526 | 流式 tool call JSON 累积与解析 |
| `src/crates/core/src/agentic/round_preempt.rs` | 124 | `DialogRoundPreemptSource` trait + 实现 |

### 2.2 完整调用链

```
ConversationCoordinator::start_dialog_turn                [coordinator.rs:990]
  └─> start_dialog_turn_internal                          [coordinator.rs:1022-1048]
        ├── 1. wrap_user_input (系统提醒词注入)            [coordinator.rs:904]
        ├── 2. scheduler.start_dialog_turn_with_execution  [coordinator.rs → scheduler.rs]
        │     ├── 创建 DialogQueuedEntry (priority, image_count, creation order)
        │     ├── 入队 + emit DialogTurnQueued             [scheduler.rs]
        │     └── flush_pending_and_dispatch_one           [scheduler.rs]
        │           └── 如果 max_pending_turns ≤ 当前 pending，返回并排队
        │           └── 否则 try_dispatch_single 取队列头
        │                 └── pop + emit DialogTurnQueueDispatching
        │                       └── spawn: execute_turn_internal
        └── 3. execute_turn_internal                       [coordinator.rs]
              ├── session_manager.start_dialog_turn        (创建 turn 记录)
              ├── emit DialogTurnStarted
              ├── execution_engine.execute_turn            [execution_engine.rs:959]
              │     │
              │     └── [核心多轮循环] execute_turn body
              │           ├── 第一轮 (initial RoundParams)
              │           │     ├── compress_context_if_needed           [L:1011-1044]
              │           │     ├── execute_round                        [L:1070]
              │           │     │     └── execute_round_with_retry       [L:~1205]
              │           │     │           ├── round_preempt_source.should_yield_after_round? [L:1201]
              │           │     │           └── execute_single_round     [L:~1307]
              │           │     │                 ├── build_user_message (含 trim_image_messages) [L:428]
              │           │     │                 │     └── 遍历 messages，计算 image_bearing_indices
              │           │     │                 │         若 images > MAX_IMAGE_BEARING_MESSAGE_ROUNDS
              │           │     │                 │         裁剪超出部分的消息 content [L:428-647]
              │           │     │                 ├── emit ModelRoundStarted
              │           │     │                 ├── ai_client.stream_chat → SSE stream
              │           │     │                 └── stream_processor.process  [stream_processor.rs]
              │           │     │                       ├── on_text → emit TextChunk          [stream_processor.rs]
              │           │     │                       ├── on_thinking → emit ThinkingChunk  [stream_processor.rs]
              │           │     │                       ├── on_tool_call → accumulator.digest [tool_call_accumulator.rs]
              │           │     │                       │     ├── NewTool → emit EarlyDetected
              │           │     │                       │     ├── 参数流 → emit ParamsPartial
              │           │     │                       │     └── 边界触发 → FinalizedToolCall
              │           │     │                       ├── tool dispatcher → execute_tool
              │           │     │                       │     ├── emit Queued → Waiting → Started
              │           │     │                       │     ├── emit Progress / Streaming / StreamChunk
              │           │     │                       │     ├── emit ConfirmationNeeded? (阻塞等确认)
              │           │     │                       │     └── emit Completed / Failed / Cancelled
              │           │     │                       └── emit ModelRoundCompleted
              │           │     │
              │           │     ├── round_outcome ──> emit TokenUsageUpdated
              │           │     │
              │           │     ├── [新的一轮迭代] for _ in 0..MAX_TURN_ROUND_RETRY_BUDGET [L:1188-1307]
              │           │     │     ├── compress_context_if_needed  (每轮都检查) [L:1242-1263]
              │           │     │     ├── round_preempt → should_yield_after_round? [L:1268-1281]
              │           │     │     │     ├── preempt_messages = take_guidance_after_round
              │           │     │     │     ├── 追加 preempt_messages 注入为新用户消息
              │           │     │     │     └── 本 turn 结束（不报错，raise preempted flag）
              │           │     │     └── execute_single_round [L:1296]
              │           │     │
              │           │     └── 循环终止条件:
              │           │           ├── finish_reason == Stop (正常完成)
              │           │           ├── round_preempt (被新排队消息打断)
              │           │           └── retry 耗尽 (MAX_TURN_ROUND_RETRY_BUDGET)
              │           │
              │           └── return DialogRoundOutcome
              │
              ├── session_manager.complete_dialog_turn
              ├── emit TokenUsageUpdated (最终汇总)
              ├── emit DialogTurnCompleted
              └── scheduler.try_start_next_queued
                    └── flush_pending_and_dispatch_one → 如果有排队 turn，递归启动
```

### 2.3 双重 Retry 预算机制

#### MAX_TURN_ROUND_RETRY_BUDGET（turn 级别）

- **位置**: `execution_engine.rs:1182`
- **值**: `6`
- **作用域**: **整个 `execute_turn` 内的多轮循环**（包含初始轮 + 所有 tool-call 后续轮）
- **含义**: 单个 dialog turn 的生命周期中最多允许 6 个 model round
- **触发后行为**: 循环正常退出，不抛异常，turn 正常完成但 round 被截断

```rust
// execution_engine.rs:1182
const MAX_TURN_ROUND_RETRY_BUDGET: u32 = 6;  // L:1182

// 使用位置: execution_engine.rs:1188
for round_index in 0..MAX_TURN_ROUND_RETRY_BUDGET {
    // ... execute_round + preempt check ...
}
```

#### MAX_ROUND_RETRIES（round 级别瞬时重试）

- **位置**: `execution_engine.rs:1181`
- **值**: `2`
- **作用域**: **单个 model round 内的 LLM API 瞬时错误重试**
- **实现位置**: `execution_engine.rs:1181` — `const MAX_ROUND_RETRIES: u32 = 2;`
- **与 `MAX_TURN_ROUND_RETRY_BUDGET` 的关系**: 不重复计入。round 级别重试在 `execute_round_with_retry` 内部完成，对外只产生 1 个 round outcome

#### turn_round_retry_budget（round 级别）

- **位置**: 在 `RoundParams` 中作为 field 传入 `execute_round` / `execute_round_with_retry`
- **作用域**: **单个 model round 内的瞬时错误重试**（如 transient LLM API 失败）
- **实现**: 在 `execute_round_with_retry` 中，通过 catch LLM error + retry loop 实现
- **不重复计入** `MAX_TURN_ROUND_RETRY_BUDGET`：round 级别重试在 `execute_round_with_retry` 内部完成，对外只产生 1 个 round outcome

```
┌─────────────────────────────────────────────────────────┐
│  execute_turn()                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ for round_index in 0..MAX_TURN_ROUND_RETRY_BUDGET │  │
│  │  (6 次硬限制)                                    │  │
│  │                                                   │  │
│  │  execute_round_with_retry(round_params)           │  │
│  │  ┌─────────────────────────────────────────┐     │  │
│  │  │ turn_round_retry_budget 次 LLM 调用重试 │     │  │
│  │  │ (瞬时错误仅此处重试，不消耗外层预算)   │     │  │
│  │  └─────────────────────────────────────────┘     │  │
│  │                                                   │  │
│  │  if preempt → break                               │  │
│  │  if stop_reason → break                           │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2.4 Round Preempt 机制

**定义位置**: `src/crates/core/src/agentic/round_preempt.rs`

```
trait DialogRoundPreemptSource: Send + Sync           [round_preempt.rs:33-43]
├── should_yield_after_round(session_id) → bool
├── clear_yield_after_round(session_id)
└── take_guidance_after_round(session_id, turn_id) → Vec<DialogTurnGuidance>

实现方:
├── SessionRoundYieldFlags  (DashMap 实现)           [round_preempt.rs:58-106]
│     ├── inner: DashMap<String, Arc<AtomicBool>>    // session → yield_flag
│     └── guidance: DashMap<String, VecDeque<..>>    // session → 排队 guidance 消息
│
├── NoopDialogRoundPreemptSource                     [round_preempt.rs:46-54]
│     └── 测试/独立执行环境使用，永远返回 false
│
└── DialogScheduler 也实现了该 trait (通过 SessionRoundYieldFlags 委托)
```

**插入点**: `execution_engine.rs:1268-1281` — 每轮结束后检查

```rust
// execution_engine.rs:1268-1281 (伪代码)
let preempt_active = self.round_preempt_source
    .should_yield_after_round(&session_id);

if preempt_active {
    let guidance = self.round_preempt_source
        .take_guidance_after_round(&session_id, &turn_id);
    // 注入 guidance 作为新的用户消息
    additional_messages.extend(guidance.iter().map(|g| Message {
        role: Role::User,
        content: g.user_input.clone(),
        ..
    }));
    self.round_preempt_source.clear_yield_after_round(&session_id);
    break; // 终止当前 turn，让调度器启动新 turn
}
```

**触发路径**:
1. 用户在队列中发送新消息 → `DialogScheduler` 调用 `request_yield(session_id)` → `SessionRoundYieldFlags` 标记
2. 下个 round 结束后 `ExecutionEngine` 检查 → yield → 当前 turn 结束
3. `ConversationCoordinator` → `scheduler.try_start_next_queued()` → 下一个排队消息成为新 turn

### 2.5 图像消息裁剪逻辑

**位置**: `execution_engine.rs:428-647` — `trim_image_messages` / `build_user_message` 方法内

```rust
// execution_engine.rs:428-647 逻辑流程:
fn build_user_message(&self, ...) {
    // 1. 计算 image_bearing_indices: Vec<usize>
    //    遍历所有历史消息，标记哪些 message index 包含 image content
    let image_bearing_indices: Vec<usize> = messages.iter()
        .enumerate()
        .filter(|(_, msg)| has_image_content(msg))
        .map(|(i, _)| i)
        .collect();

    // 2. 如果 image_bearing_indices.len() > MAX_IMAGE_BEARING_MESSAGE_ROUNDS
    //    从最旧的 image 开始裁剪，保留最近的 MAX_IMAGE_BEARING_MESSAGE_ROUNDS 个
    let images_to_trim = image_bearing_indices.len()
        .saturating_sub(MAX_IMAGE_BEARING_MESSAGE_ROUNDS);
    for &idx in &image_bearing_indices[..images_to_trim] {
        messages[idx].content = trim_image_content(messages[idx].content);
                                      // 将 image content → "image content removed" 占位文本
    }
}
```

**常量定义**: `execution_engine.rs:451` — `const MAX_IMAGE_BEARING_MESSAGE_ROUNDS: usize = 2;`
**效果**: 仅保留最近 2 轮图像，更早的图像 context 被替换为占位文本，防止上下文窗口被大量历史图像撑爆

### 2.6 ExecutionEngine 与 Coordinator 的交互边界

```
┌─────────────────────────────────────────────────────────────────────┐
│  ConversationCoordinator                                             │
│  ├── 承担: session lifecycle、turn 创建/完成、事件 emission           │
│  ├── 承担: system_reminder 注入、用户输入包装 (wrap_user_input)       │
│  ├── 承担: 压缩触发、手动维护 turn (compact_session_manually)         │
│  │                                                                   │
│  ├──> ExecutionEngine                                                │
│  │     ├── execute_turn → 纯执行：多轮 LLM 调用 + tool dispatch       │
│  │     ├── compact_session_context → 上下文压缩 (LLM summary)         │
│  │     ├── compress_messages → 消息裁剪 (trim 旧内容)                 │
│  │     └── 不承担 session 状态管理，不 emit session 级别事件          │
│  │                                                                   │
│  └──> StreamProcessor                                                │
│        ├── 放入 ExecutionEngine/子 agent 的 Tokio task 中运行        │
│        ├── SSE → TextChunk / ThinkingChunk / ToolEvent emission      │
│        └── tool_call_accumulator → 流式 JSON 累积 + 最终解析          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 压缩系统

### 3.1 涉及文件

| 文件 | 行数 | 角色 |
|------|------|------|
| `src/crates/core/src/agentic/session/compression/compressor.rs` | 1012 | 主压缩控制器：三层压缩 + 熔断器 |
| `src/crates/core/src/agentic/session/compression/microcompact.rs` | ~400 | 微压缩：智能裁剪对话中已完成的 tool 轮 |
| `src/crates/core/src/agentic/session/compression/fallback/mod.rs` | 29 | 降级策略：结构化摘要生成（无需 LLM） |
| `src/crates/core/src/agentic/session/compression/fallback/builder.rs` | — | 从 turn 构建压缩条目 |
| `src/crates/core/src/agentic/session/compression/fallback/payload.rs` | — | 按 token budget 裁剪 payload |
| `src/crates/core/src/agentic/session/compression/fallback/render.rs` | — | 将 payload 渲染为模型可读文本 |
| `src/crates/core/src/agentic/session/compression/fallback/sanitize.rs` | — | 压缩文本 sanitization |
| `src/crates/core/src/agentic/session/compression/fallback/types.rs` | — | `CompressionFallbackOptions`, `CompressionSummaryArtifact` |

### 3.2 三层压缩架构 (L0 / L1 / L2)

```
L0 — MicroCompact (微压缩)
├── 触发条件: 每次 execute_turn 开始时 compress_context_if_needed → 检查
├── 作用范围: 当前 session 的 context messages
├── 实现: microcompact.rs — 智能查找已完成的 tool round 并裁剪文本
├── 不调用 LLM，纯文本处理
├── compressor.rs 在调用 execute_compression 时先尝试 L0 [compressor.rs:L200-397]
│
L1 — LLM 摘要压缩
├── 触发条件: L0 不够时 → execute_compression [compressor.rs:~500]
│     └── 调用 compress_messages → 发送 LLM 请求做摘要生成
├── 作用范围: 将多轮对话压缩为 "previous conversation summary" 文本
├── 实现: compressor.rs 中 execute_compression → ai_client.generate
│     └── 生成 compression_prompt → 发送 LLM summary 请求
├── retry: compressor.rs:589 `generate_summary_with_retry(..., 2)` — 指数退避重试
│     └── base_wait 500ms, 延迟公式 `500ms * 2^attempt`, 最多 2 次尝试
│     └── 2 次全部失败后才触发 L2 fallback
├── emit: ContextCompressionStarted → ContextCompressionCompleted
│
L2 — 结构化降级 (Fallback)
├── 触发条件: L1 LLM 调用失败 → 熔断器递增 → 可能触发 L2
├── 作用范围: 相同消息范围，但不调用 LLM
├── 实现: fallback/mod.rs → build_structured_compression_summary
│     └── build_entries_from_turns → trim_payload_to_budget → render_payload_for_model
├── 不 emit 独立事件（作为 L1 的失败恢复路径）
└── used_model_summary: false (标记为纯结构摘要)
```

### 3.3 熔断器机制

**常量定义**: `execution_engine.rs:1175` — `const MAX_CONSECUTIVE_COMPRESSION_FAILURES: u32 = 3;`

**状态字段**: `CompressionState` 中的 `consecutive_compression_failures: usize` 字段（在 `compressor.rs` 中维护）

```
压缩状态:
├── consecutive_compression_failures: usize  (记录在 CompressionState 中)
├── 每次 L1 压缩重试全部失败 → +1 (L1 自身有 2 次指数退避重试)
├── 每次 L1 压缩成功 → 重置为 0
└── 阈值: MAX_CONSECUTIVE_COMPRESSION_FAILURES = 3  (execution_engine.rs:1175)

熔断器行为:
├── consecutive_compression_failures >= 3 → 暂停 L1 压缩
│     └── 改走 L2 fallback 路径（不消耗 LLM API）
├── 后续回合仍尝试 L0 (微压缩无效 → 继续 fallback)
└── 重置条件: 上下文自然衰减 (turn 完成/清理) → 重置 counts
```

**计数位置**: `compressor.rs` 中 `execute_compression` 函数内（计数器字段定义在 `CompressionState`）:
- 成功路径: `consecutive_compression_failures = 0`
- 失败路径: `consecutive_compression_failures += 1`（在 L1 的 2 次指数退避重试全部失败后）
- 阈值检查: 调用方 `execution_engine.rs` 读取 `MAX_CONSECUTIVE_COMPRESSION_FAILURES = 3` 判断是否超过阈值

### 3.4 压缩事件 Emit 位置

| 事件 | Emit 位置 | 时机 |
|------|-----------|------|
| `ContextCompressionStarted` | `compressor.rs` (execute_compression 入口) | L1 LLM 摘要开始前 |
| `ContextCompressionCompleted` | `compressor.rs` (execute_compression 成功) | L1 LLM 摘要返回后 |
| `ContextCompressionFailed` | `compressor.rs` (execute_compression 失败) | L1 LLM 调用异常/超时 |

### 3.5 压缩与 ExecutionEngine 交互时序

```
execute_turn()
  │
  ├──► compress_context_if_needed                  [execution_engine.rs:1011]
  │      │
  │      ├── 检查剩余 token 空间 (ContextBudgetUpdated)
  │      ├── 检查 CompressionState (consecutive_compression_failures vs MAX_CONSECUTIVE_COMPRESSION_FAILURES=3)
  │      ├── compressor.execute_compression       [compressor.rs]
  │      │     ├── L0 → microcompact.try_compact
  │      │     ├── L1 → llm_summarize
  │      │     │     ├── emit ContextCompressionStarted
  │      │     │     └── emit ContextCompressionCompleted
  │      │     └── L2 → fallback (if L1 fails / circuit breaker open)
  │      │           └── consecutive_compression_failures += 1
  │      │
  │      └── replace context_messages with compressed result
  │
  ├──► execute_round() → LLM 调用 (使用压缩后的 context)
  └──► ...
```

**注意**: `context_store.rs` (仅 59 行) 维护的是内存中的消息 ID 索引和 metadata，不直接参与压缩。

---

## 4. 事件总线

### 4.1 涉及文件

| 文件 | 行数 | 角色 |
|------|------|------|
| `src/crates/events/src/agentic.rs` | 688 | `AgenticEvent` 枚举 (31 变体) + `ToolEventData` (14 变体) + 优先级/Envelope |
| `src/crates/events/src/lib.rs` | — | events crate 公共导出 |
| `src/crates/events/src/emitter.rs` | — | `EventEmitter` trait |
| `src/crates/events/src/types.rs` | — | 事件基础类型 |
| `src/crates/core/src/agentic/events/queue.rs` | ~200 | `AgenticEventQueue` — BinaryHeap 优先级队列 |
| `src/crates/core/src/agentic/events/router.rs` | — | 事件路由器：分发到 transport / 持久化 / context_store |
| `src/crates/core/src/agentic/events/types.rs` | — | 核心侧事件类型 |
| `src/crates/transport/src/event_bus.rs` | — | `EventBus` 实现：核心侧 ↔ 传输层桥接 |
| `src/crates/transport/src/events.rs` | — | 传输事件定义 |
| `src/crates/transport/src/traits.rs` | — | `AgenticToTransportAdapter` trait |

### 4.2 AgenticEvent 优先级模型

**定义位置**: `src/crates/events/src/agentic.rs`

```rust
pub enum AgenticEventPriority {     // L:~1-8
    Critical,  // 系统错误、turn 失败、turn 取消
    High,      // 会话状态变更、压缩失败、模型自动迁移
    Normal,    // 大部分运行时事件
    Low,       // 不重要的后台事件
}
```

**优先级分配** (`agentic.rs:510-546`):

```
Critical:
  ├── SystemError
  ├── DialogTurnFailed
  └── DialogTurnCancelled

High:
  ├── SessionStateChanged
  ├── SessionTitleGenerated
  ├── SessionModelAutoMigrated
  └── ContextCompressionFailed

Normal:
  ├── ImageAnalysisStarted / ImageAnalysisCompleted
  ├── TextChunk / ThinkingChunk
  ├── ModelRoundStarted / ModelRoundCompleted
  ├── ToolEvent (根据子类型优先级映射)
  ├── DialogTurnQueued / QueueUpdated / QueueDeleted
  ├── DialogTurnQueueDispatching / QueuePaused / QueueResumed
  ├── DialogTurnGuidanceRequested / GuidanceApplied / GuidanceFailed
  ├── TokenUsageUpdated / ContextBudgetUpdated
  ├── DialogTurnCompleted
  └── ContextCompressionStarted / ContextCompressionCompleted

Low (default):
  ├── SessionCreated / SessionDeleted
  └── DialogTurnStarted (第一个 user message round 开始)
```

### 4.3 交付语义 (DeliveryClass)

**定义位置**: `agentic.rs:549-568`

```rust
pub enum AgenticEventDeliveryClass {
    OrderedTimeline,   // 严格按 seq 排序，保证时序一致
    PriorityControl,   // 优先级优先，可跳过低优先级排队
}
```

| 类别 | 包含事件 |
|------|----------|
| **PriorityControl** | SessionCreated, SessionStateChanged, SessionDeleted, SessionTitleGenerated, TokenUsageUpdated, ContextBudgetUpdated, SystemError, SessionModelAutoMigrated |
| **OrderedTimeline** | 所有回合和工具事件：DialogTurn*, ModelRound*, TextChunk, ThinkingChunk, ToolEvent, ImageAnalysis*, ContextCompression* |

### 4.4 事件队列数据结构

**位置**: `src/crates/core/src/agentic/events/queue.rs`

队列使用 **`BinaryHeap<AgenticEventEnvelope>`** 实现:

```rust
// agentic.rs:428-468
pub struct AgenticEventEnvelope {
    pub id: String,                    // UUID v4
    pub event: AgenticEvent,
    pub priority: AgenticEventPriority,
    pub sequence: u64,                 // 单调递增序列号
    pub timestamp: SystemTime,
}

impl Ord for AgenticEventEnvelope {    // agentic.rs:450-457
    fn cmp(&self, other: &Self) -> Ordering {
        match self.priority.cmp(&other.priority) {
            Ordering::Equal => self.sequence.cmp(&other.sequence),
            other => other,
        }
    }
}
```

**排序规则**: 先按 `priority` 排序 (Critical > High > Normal > Low)，同优先级再按 `sequence` 排序（先到先出）。

### 4.5 跨 Crate 事件流图和所有权

```
┌────────────────────────────────────────────────────────────────────┐
│  events crate (bitfun_events)                                      │
│  ├── AgenticEvent (31 变体)  ← 零 bitfun 依赖的纯数据合约           │
│  ├── ToolEventData (14 变体)                                       │
│  ├── AgenticEventPriority / AgenticEventDeliveryClass               │
│  ├── AgenticEventEnvelope (序列号 + time 戳 + priority)             │
│  └── EventEmitter trait (emit / emit_many)                         │
│                                                                     │
│  ↑ depends on: serde, uuid, serde_json (零 bitfun crates)          │
│  ↓                                                         ↓       │
│  core crate                                            transport   │
│  ├── agentic/events/queue.rs ─ BinaryHeap<Envelope>    ├── event_bus│
│  ├── agentic/events/router.rs ─ 分发逻辑               ├── events   │
│  ├── agentic/events/types.rs ─ 核心侧事件包装           └── traits   │
│  └── 发射位置遍布: coordinator, execution_engine,                     │
│        compressor, scheduler, session_manager                          │
│                                                                        │
│  数据流方向:                                                           │
│  core ──创建──> AgenticEvent ──envelope──> EventEmitter               │
│                                              │                         │
│                                              ├──> transport.EventBus   │
│                                              │     └── Tauri emit      │
│                                              │         ├── WebView     │
│                                              │         └── CLI 面       │
│                                              │                         │
│                                              └──> 持久化 (可选)         │
└────────────────────────────────────────────────────────────────────┘
```

**所有权**: `core` crate 是事件的**生产者**，`events` crate 是**合约定义者**，`transport` crate 是**桥接消费者**。

---

## 5. 协调层

### 5.1 涉及文件

| 文件 | 行数 | 角色 |
|------|------|------|
| `src/crates/core/src/agentic/coordination/scheduler.rs` | 1357 | `DialogScheduler`：优先级队列 + 调度策略 |
| `src/crates/core/src/agentic/coordination/coordinator.rs` | 3354 | `ConversationCoordinator`：turn 完整生命周期 |
| `src/crates/core/src/agentic/coordination/state_manager.rs` | — | Session 状态变换 |
| `src/crates/core/src/agentic/coordination/turn_outcome.rs` | — | Turn 结果枚举 |

### 5.2 协调栈层级和数据流方向

```
┌──────────────┐
│  外部入口     │  Tauri command / CLI / programmatic API
├──────────────┤
│  Coordinator │  ConversationCoordinator::start_dialog_turn  [L:990]
│              │   └── 包装用户输入 → 系统提醒词注入 → 入队
├──────────────┤
│  Scheduler   │  DialogScheduler
│              │   ├── add_turn → 入队 + emit DialogTurnQueued
│              │   ├── try_dispatch_single → 取队列头 + 启动执行
│              │   └── try_start_next_queued → 完成一个后取下一个
├──────────────┤
│  Engine      │  ExecutionEngine::execute_turn
│              │   └── 多轮 LLM 循环 + tool 分派 + preempt 检查
├──────────────┤
│  Session     │  SessionManager
│              │   ├── start_dialog_turn / complete_dialog_turn
│              │   ├── context_messages 管理
│              │   └── compression_state 维护
├──────────────┤
│  Persistence │  PersistenceManager
│              │   ├── save / load session
│              │   ├── save / load dialog turn (JSON 文件)
│              │   └── session index 管理
└──────────────┘

数据流:  用户输入 → coordinator → scheduler → coordinator → engine → coordinator → session_manager → persistence
           ↑                                                                    ↑
           └──────────────────── 事件流 (实时) ──────────────────────────────────┘
                                 transport → Tauri emit → WebView
```

### 5.3 Scheduler 优先级队列

**数据结构**: `scheduler.rs` 中维护的 `pending_queues: DashMap<session_id, VecDeque<DialogQueuedEntry>>`

```
DialogQueuedEntry {
    turn_id: String,
    priority: u8,
    image_count: usize,
    creation_order: u64,        // 先入先出的时间戳
    // + 用户输入、agent_type 等
}
```

**排序策略**: 由 `flush_pending_and_dispatch_one` / `try_dispatch_single` 控制:
1. 每次 dispatch 取队列头 (FIFO，按 creation_order)
2. preempt: 新消息到达 → `request_yield` 标记 → 当前 turn 结束后下一个立即开始
3. **队列容量**: `max_pending_turns` 通过 session config 控制，默认由 `DialogQueueConfig.max_pending_turns` 设置

### 5.4 Coordinator 的 Turn 生命周期状态机

**入口**: `ConversationCoordinator::start_dialog_turn` [coordinator.rs:990]

```
┌──────────────────────────────────────────────────────────────────┐
│  DialogTurnQueued          ← scheduler.add_turn()               │
│  │                       [scheduler.rs: add_turn 中 emit]       │
│  │                                                               │
│  ├──► DialogTurnQueueDispatching  ← try_dispatch_single         │
│  │     │                    [scheduler.rs: pop + spawn task]     │
│  │     │                                                         │
│  │     └──► DialogTurnStarted  ← start_dialog_turn_internal     │
│  │           │              [coordinator.rs: emit]               │
│  │           │                                                   │
│  │           ├──► ModelRoundStarted  ← 每轮 LLM 调用前           │
│  │           │     │                  [execution_engine.rs]      │
│  │           │     ├── TextChunk / ThinkingChunk  (streaming)    │
│  │           │     │     │                                       │
│  │           │     │     ├── ToolEvent (EarlyDetected → ... →    │
│  │           │     │     │            Completed/Failed)          │
│  │           │     │     │                                       │
│  │           │     │     └── ModelRoundCompleted                 │
│  │           │     │                                             │
│  │           │     └── subround (if tool called → next round)    │
│  │           │           ↑ 循环直到 STOP 或 preempt               │
│  │           │                                                   │
│  │           ├──► DialogTurnCompleted  ← turn 正常完成           │
│  │           │     [coordinator.rs: emit + persist]              │
│  │           │                                                   │
│  │           ├──► DialogTurnFailed  ← 异常/错误                  │
│  │           │     [coordinator.rs: emit + persist error]        │
│  │           │                                                   │
│  │           └──► DialogTurnCancelled  ← 用户取消                 │
│  │                 [coordinator.rs: emit + persist cancelled]    │
│  │                                                                 │
│  └── [完成后] scheduler.try_start_next_queued()                    │
│        └── 如果队列非空 → 递归进入 DialogTurnQueueDispatching     │
└──────────────────────────────────────────────────────────────────┘
```

### 5.5 StateManager 管理的状态

**文件**: `src/crates/core/src/agentic/coordination/state_manager.rs`

```
SessionState:
├── Idle
├── Processing { current_turn_id, phase }
│     └── phase: Starting | Executing | Compressing | Completing
├── Error { error, current_turn_id }
└── (Terminal variants)

维护路径:
├── session_manager.update_session_state(Idle)
├── session_manager.update_session_state(Processing { .. })
├── session_manager.update_session_state(Error { .. })
└── persistence_manager.save_session_state (持久化)
```

---

## 6. 持久化层

### 6.1 涉及文件

| 文件 | 行数 | 角色 |
|------|------|------|
| `src/crates/core/src/agentic/persistence/manager.rs` | 2427 | 主持久化管理器 |
| `src/crates/core/src/agentic/persistence/session_branch.rs` | ~300 | Session 分支 (fork/merge) |
| `src/crates/core/src/agentic/session/session_manager.rs` | — | 内存 session 生命周期 |
| `src/crates/core/src/agentic/session/context_store.rs` | 59 | 上下文消息索引存储 |

### 6.2 持久化后端

**纯文件系统 JSON 存储**（非 SQLite）:

```
会话存储布局:
<workspace>/.sparo_os/sessions/<session_id>/
├── meta.json                    # SessionMetadata
├── state.json                   # StoredSessionStateFile
├── turns/
│   ├── 000001.json              # StoredDialogTurnFile
│   ├── 000002.json
│   └── ...
└── index.json                   # 可选：时序索引
```

**关键操作** (persistence/manager.rs):

```
save_session_metadata    → meta.json           [L:~600]
save_session_state       → state.json          [L:1679]
save_dialog_turn         → turns/<index>.json  [L:1762]
load_session             → meta + state + turns[L:1615]
delete_session           → remove_dir_all      [L:1707]
list_sessions            → 扫描 meta.json       [L:1725]
```

**原子写入**: `write_json_atomic` — 先写临时文件，然后 rename，防止写入中断破坏数据。

### 6.3 Session Branch Fork/Merge 模型

**文件**: `src/crates/core/src/agentic/persistence/session_branch.rs`

```
Fork 语义:
├── session_branch 记录: parent_session_id → child_session_id
├── fork 时: 复制 parent 的 context_messages 到 child session
│     └── load_session_context_messages → start new session
├── 用途: Subagent 分支执行、Task tool 分流
└── 不 merge: child session 的上下文变更不反向写回 parent
    (fork 仅共享起点上下文，之后各自独立)
```

### 6.4 ContextStore 存储内容

**文件**: `src/crates/core/src/agentic/session/context_store.rs` (59 行)

```rust
// context_store 维护:
// - message_id → session_id 映射
// - 消息变更追踪 (压缩前后替换)
// - 纯内存数据结构，不持久化
// 核心作用: session_manager 中 context_messages 的查询加速索引
```

---

## 7. Agent 注册与工具框架

### 7.1 涉及文件

| 文件 | 行数 | 角色 |
|------|------|------|
| `src/crates/core/src/agentic/agents/registry.rs` | 1573 | Agent 注册表 (全局单例) |
| `src/crates/core/src/agentic/agents/mod.rs` | — | Agent 模块入口 |
| `src/crates/core/src/agentic/tools/framework.rs` | ~300 | 工具 trait 框架 |
| `src/crates/core/src/agentic/tools/registry.rs` | — | 工具注册表 |
| `src/crates/core/src/agentic/tools/restrictions.rs` | — | 工具可用性限制 |

### 7.2 注册的 Agent 类型清单

**来源**: `agents/registry.rs:764-798` — `list_agents_info()` 排序列表

| Agent ID | 类别 | 排序 | 说明 |
|----------|------|------|------|
| `agentic` | Agent | 0 | 默认主 agent (始终 enabled) |
| `Cowork` | Agent | 1 | 协作者 |
| `Design` | Agent | 2 | 设计师 |
| `LiveAppStudio` | Agent | 3 | Live App 工作室 |
| `Plan` | Agent | 4 | 规划模式 |
| `debug` | Agent | 5 | 调试 agent |
| `OSAgent` | Agent | — | 系统 agent (排除在 list_agents_info 外) |
| (自定义) | AgentApp | 99 | 用户自定义 agent app |

**Agent 注册模式** (registry.rs):

```rust
// 注册通过 lazy_static 全局 Registry 完成:
// - 内置 agents: 直接插入 agent_registry Map
// - 自定义 subagents: load_custom_subagents(workspace_root)
// - Project subagents: 从 .sparo_os 配置加载
```

**Agent 分类**:
- `AgentCategory::Agent` — 顶层可切换 agent
- `AgentCategory::SubAgent` — Task tool 可调用的子 agent
- `AgentCategory::AgentApp` — FlowChat-native 应用

### 7.3 工具框架 Trait/接口设计

**文件**: `tools/framework.rs`

```
工具生命周期:
┌────────────┐
│  注册阶段   │  tools/registry.rs 中 register_tool(ToolDef)
│            │  ├── tool_name / description (Prompt 注入)
│            │  ├── parameter_schema (JSON Schema)
│            │  ├── ToolExecutor (trait impl)
│            │  ├── ToolCardConfig (前端渲染)
│            │  └── restrictions (Agent scope / mode 限制)
├────────────┤
│  检测阶段   │  LLM 返回 function_call → stream_processor
│            │  → tool_call_accumulator 累积完整 JSON
│            │  → emit ToolEvent { EarlyDetected → ParamsPartial → Queued }
├────────────┤
│  执行阶段   │  ToolDispatcher → ToolExecutor::execute(args)
│            │  ├── emit Started
│            │  ├── emit Progress / Streaming / StreamChunk
│            │  ├── [可选] ConfirmationNeeded → 阻塞等用户确认
│            │  └── emit Completed / Failed
├────────────┤
│  结果阶段   │  tool_result → content_to_messages() → 注入 context
│            │  execution_types.rs 中 tool_result content 抽帧
│            │  → 下个 round 包含 tool 结果作为 assistant message
└────────────┘
```

**工具限制** (`tools/restrictions.rs`):
- 按 Agent 类型控制工具可用性 (e.g., 只读 SubAgent 不暴露写入工具)
- 按 Session kind (Standard / Subagent / Maintenance) 控制
- 按 `AgentCapabilityProfile` 动态生效

### 7.4 注册的工具清单 (部分)

从 `agentic/tools/implementations/` 目录中按功能域分组:
- **File System**: `Read`, `Write`, `Edit`, `Delete`, `Glob`, `Grep`, `LS`, `Bash`
- **Agentic**: `Task` (子 agent 启动), `TodoWrite`, `AskUserQuestion`, `Memory`
- **Browser**: `ComputerUse` (桌面自动化), `ControlHub`, `WebSearch`, `WebFetch`
- **UI**: `GenerativeUI`, `Skill`
- **Meta**: `ControlHub` (`domain: "browser"/"terminal"/"meta"`)

### 7.5 Computer Use 工具实现文件

```
src/crates/core/src/agentic/tools/implementations/computer_use/
├── mod.rs                              # 工具入口 + ToolExecutor trait impl
├── computer_session.rs                 # Computer Use session 管理
└── (other platform abstraction files)

src/crates/core/src/agentic/computer_use/
├── (通用抽象层)
```

平台抽象通过 `src/apps/desktop` 层注入 desktop 特定依赖 (key_chord, screenshot 等)。

---

## 8. 跨 Crate 依赖图

### 8.1 四 Crate 依赖关系

```
                    ┌──────────────┐
                    │  events      │
                    │ (bitfun_     │
                    │  events)     │
                    │              │
                    │ deps:        │
                    │  serde       │
                    │  uuid        │
                    │  serde_json  │
                    └───┬──────┬───┘
                        │      │
              depends on│      │depends on
                        ↓      ↓
        ┌───────────┐      ┌──────────────┐
        │  core     │      │  transport   │
        │  (bitfun_ │      │  (bitfun_    │
        │  core)    │      │  transport)  │
        │           │      │              │
        │ deps:     │      │ deps:        │
        │  events   │      │  events      │
        │  ai-      │      │  core (?)    │
        │  adapters │      │  serde       │
        │  tokio    │      │              │
        │  dashmap  │      └──────────────┘
        │  serde    │
        └─────┬─────┘
              │
    depends on│
              ↓
        ┌──────────────┐
        │  ai-adapters │
        │  (bitfun_ai_ │
        │  adapters)   │
        │              │
        │ deps:        │
        │  serde       │
        │  serde_json  │
        │  reqwest     │
        │  tokio       │
        └──────────────┘
```

**依赖方向** (由 Cargo.toml 确认):
```
events         → (零 bitfun 依赖)
core           → events + ai-adapters + 通用 crates (tokio, dashmap, serde)
transport      → events + core (通过 trait 注入)
ai-adapters    → (独立，仅 serde/reqwest)
```

### 8.2 零依赖原则验证

**events crate** (`src/crates/events/Cargo.toml`):
- 依赖: `serde`, `uuid`, `serde_json`, `chrono` (可选)
- **无任何 bitfun_* 依赖** — 确认为零 bitfun 依赖
- 这是架构中的"合约层"：纯数据结构，被所有其他 crate 依赖但不依赖任何业务 crate

### 8.3 各 Crate 公开 API

**events crate** (`src/crates/events/src/lib.rs`):
```rust
pub use agentic::{
    AgenticEvent, ToolEventData,
    AgenticEventPriority, AgenticEventDeliveryClass,
    AgenticEventEnvelope,
};
pub use emitter::EventEmitter;
pub use types::*;
```

**core crate** 主要导出 (`src/crates/core/Cargo.toml` + lib.rs):
```toml
[features]
# 核心模块通过 features 控制编译
agentic = [...]
service = [...]
infrastructure = [...]
runtime = [...]
```

**transport crate** (`src/crates/transport/Cargo.toml`):
```toml
[dependencies]
bitfun_events = { path = "../events" }
bitfun_core = { path = "../core" }  # (可能通过 trait 依赖)
```

### 8.4 整体依赖流向

```
apps/desktop ──→ core (agentic runtime)
               ├── transport (event bus → WebView)
               └── events (类型)

apps/cli ──────→ core
               └── events

web-ui ──────→ transport (通过 Tauri invoke)
              └── events (WebView 端类型定义)
```

---

## 9. 架构评分与风险

### 9.1 架构优点

| 维度 | 评分 | 说明 |
|------|------|------|
| 分层清晰 | A | events → core → transport → apps 单向依赖，无循环 |
| 零依赖合约 | A | events crate 零业务依赖，可独立演进 |
| 事件驱动 | A- | 31 变体 AgenticEvent 覆盖完整生命周期，BinaryHeap 优先级队列 |
| 压缩系统 | B+ | 三层压缩 + 熔断器设计完善，但 L0 microcompact 效果需实际测量 |
| 执行循环 | B | 双重 retry + preempt 机制灵活，但 MAX_TURN_ROUND_RETRY_BUDGET=6 对 3+ tool chain 就接近极限 |

### 9.2 P0 / P1 / P2 风险

#### P0 — Critical

无 P0 级架构缺陷。

#### P1 — High

1. **MAX_TURN_ROUND_RETRY_BUDGET = 6 硬限制** (`execution_engine.rs:1182`)
   - 对于涉及多个 tool call 轮次的任务（如多文件搜索 + 编辑 + 测试循环），6 round 很窄
   - 超过后 turn 静默截断，用户感知为"未完成任务"，但不会报错提示
   - 风险严重性较原审计更高：13+ tool chain 极易被截断
   - 建议: 提升到 12-15，或在截断时 emit warning 事件

2. **Coordinator 单文件 3354 行** (`coordinator.rs`)
   - 包含 session lifecycle + turn lifecycle + event emission + compression + auto memory 等多个关注点
   - 建议按职责拆分: `turn_runner.rs` (turn 执行) / `compression_coordinator.rs` (压缩触发) / `auto_memory_coordinator.rs`

3. **图像裁剪无事件通知** (`execution_engine.rs:428-647`)
   - 图像被裁剪为占位文本时，不 emit 任何事件
   - 用户和 UI 无法感知历史图像已被裁剪
   - 建议: emit `ContextBudgetUpdated` 附带 `trimmed_images: usize` 字段

#### P2 — Medium

4. **ContextStore 仅 59 行** (`context_store.rs`)
   - 当前为纯内存简单索引，不持久化
   - 如果未来需要跨 session 迁移消息上下文，需扩展

5. **Scheduler 队列容量未在代码中明确定义**
   - `max_pending_turns` 通过 session config 控制
   - 默认值未在 scheduler.rs 中以 const 形式声明显式

6. **Fallback 压缩为纯结构摘要** (`compression/fallback/mod.rs:13-26`)
   - `used_model_summary: false` 标记为纯文本摘要
   - 在 LLM 不可用时长对话质量会明显下降
   - 可考虑: 本地小模型 fallback 方案

7. **SessionBranch 不 merge** (`persistence/session_branch.rs`)
   - fork 后 child session 的上下文变更不反写 parent
   - SubAgent 完成后的知识不会自动回流，需要显式 summary
   - 这是设计选择而非 bug，但值得在文档中标注

---

## 附 A: 事件名完整性自检

### AgenticEvent (31 变体) — 全部来自 agentic.rs:48-349

1. `SessionCreated` — L:48-54
2. `SessionStateChanged` — L:56-61
3. `SessionDeleted` — L:63-64
4. `SessionTitleGenerated` — L:66-76
5. `ImageAnalysisStarted` — L:78-85
6. `ImageAnalysisCompleted` — L:87-94
7. `DialogTurnStarted` — L:96-115
8. `DialogTurnCompleted` — L:117-133
9. `DialogTurnCancelled` — L:135-141
10. `DialogTurnFailed` — L:143-150
11. `DialogTurnQueued` — L:152-162
12. `DialogTurnQueueUpdated` — L:164-173
13. `DialogTurnQueueDeleted` — L:175-183
14. `DialogTurnQueueDispatching` — L:185-193
15. `DialogTurnQueuePaused` — L:195-202
16. `DialogTurnQueueResumed` — L:204-211
17. `DialogTurnGuidanceRequested` — L:213-225
18. `DialogTurnGuidanceApplied` — L:227-240
19. `DialogTurnGuidanceFailed` — L:242-254
20. `TokenUsageUpdated` — L:256-261
21. `ContextBudgetUpdated` — L:263-268
22. `ContextCompressionStarted` — L:270-277
23. `ContextCompressionCompleted` — L:279-287
24. `ContextCompressionFailed` — L:289-297
25. `ModelRoundStarted` — L:299-305
26. `ModelRoundCompleted` — L:307-316
27. `TextChunk` — L:318-325
28. `ThinkingChunk` — L:327-334
29. `ToolEvent` — L:336-346
30. `SystemError` — L:348-354
31. `SessionModelAutoMigrated` — L:356-361(+2)

### ToolEventData (14 变体) — 全部来自 agentic.rs:365-425

1. `EarlyDetected` — L:366-371
2. `ParamsPartial` — L:373-380
3. `Queued` — L:382-386
4. `Waiting` — L:387-391
5. `Started` — L:392-395
6. `Progress` — L:396-400
7. `Streaming` — L:401-404
8. `StreamChunk` — L:405-409
9. `ConfirmationNeeded` — L:410-415
10. `Confirmed` — L:416-419
11. `Rejected` — L:416-419 (paired with Confirmed)
12. `Completed` — L:420-426
13. `Failed` — L:427-434
14. `Cancelled` — L:420-425

**所有 45 个事件名均来自 agentic.rs 的 serde tagged enum 定义，无任何虚构名称。**
