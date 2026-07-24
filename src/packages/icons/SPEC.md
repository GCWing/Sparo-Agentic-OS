# Sparo OS System Icons 设计规范

## 1. 核心判断

SVG 是否高清与 `viewBox` 数字大小无直接关系。Lucide 的默认图标是 24×24，但官方允许通过 `size` 或 CSS 输出到 64px、96px，并提供 `absoluteStrokeWidth` 控制跨尺寸的屏幕描边。因此，Sparo 不把“24”理解为 24 像素位图。

Sparo 仍采用更大的 `48 × 48` 母版，原因是这批图标表达系统入口、工作类型、大尺寸导航及品牌化语义操作，而不是 24px 工具栏里的紧凑操作符号。更大的母版便于管理曲线、负空间、品牌椭圆和强调态内缩，并给文件传输、编辑管理等组合图标留出精度。

## 2. 同类库对比

| 图标库 | 官方规格 | 可借鉴点 | Sparo 取舍 |
| --- | --- | --- | --- |
| [Lucide](https://lucide.dev/guide/basics/sizing) | 默认 24×24；尺寸可调到 64/96；默认描边 2；支持固定屏幕描边 | 简洁 React API、`currentColor`、`absoluteStrokeWidth`、tree shaking | 保留相同 API 心智模型，但不复用 24 母版作为大入口图标源 |
| [Material Symbols](https://developers.google.com/fonts/docs/material_symbols) | 光学尺寸轴为 20–48dp，尺寸变化时同步调整笔画 | 光学尺寸不是机械缩放 | 定义 48–128px 输出档位；复杂图标需要按档位复核 |
| [Fluent System Icons](https://github.com/microsoft/fluentui-system-icons) | 按 12/16/20/24/28/32/48 等尺寸提供资产；48px 图标有独立线宽与留白 | 大尺寸需要独立母版和更大安全区 | 选择 48 母版、4 单位安全区，并按参考原稿校准为 2 单位描边 |
| [Heroicons](https://github.com/tailwindlabs/heroicons) | 24 outline/solid，20 solid，16 solid | 不同尺寸是独立集合，不把所有图标自动缩到微型尺寸 | Sparo System Icons 不承担 24px 以下的密集操作图标 |
| [Phosphor](https://github.com/phosphor-icons/react) | 256×256 坐标空间，多种 weight，颜色和尺寸可配置 | 大坐标网格也可通过统一组件 API 输出任意尺寸 | Sparo 不需要 256 网格的复杂度，48 足以表达当前线性语言 |

## 3. 母版几何

| 规则 | 数值 |
| --- | --- |
| `viewBox` | `0 0 48 48` |
| 内容区域 | `40 × 40` |
| 基础安全区 | 四边各 4 单位 |
| 标准描边 | 2 单位 |
| 允许描边 | 1.5–4 单位；默认不按图标单独改变 |
| 端点与连接 | `round / round` |
| 坐标精度 | 整数优先；曲线与品牌椭圆允许 0.1 单位 |
| 填充 | Base 必须为 `none`；Emphasis 只允许背景层填充 |
| 颜色 | Base 使用 `currentColor`；Emphasis 前景与背景分离 |

几何应优先落在 1 单位网格；需要光学居中时可偏移 0.5 单位。不要为了数学对称破坏视觉重心。

## 4. 推荐输出尺寸

| 尺寸 | 用途 | 验收重点 |
| --- | --- | --- |
| 48px | 最小系统入口、紧凑面板 | 轮廓不能粘连；细节仍可辨 |
| 64px | 默认组件尺寸 | 与 24px Lucide 操作图标形成清楚层级 |
| 80px | 左下角展开窗口常规尺寸 | 推荐产品使用档位 |
| 96px | 强调入口、展示板 | 与参考图视觉密度最接近 |
| 128px | 独立预览、营销/文档展示 | 曲线与负空间必须干净 |

`24px` 不是这个图标集的目标尺寸。产品中的紧凑关闭、搜索、设置等通用小图标继续使用 `lucide-react`；Sparo 的导航、搜索筛选、文件传输与编辑管理 family 用于 48px 及以上的大尺寸面板与强调入口。如果未来确需 24px 的 Sparo 语义图标，应建立独立 Compact 光学集合，而不是自动缩小 48 母版。

## 5. 描边模式

默认模式与 SVG/Lucide 一致：图标扩大时，描边按比例扩大。

```tsx
<MemoryIcon size={96} strokeWidth={2} />
```

固定屏幕描边模式用于不同尺寸并排但希望线宽一致的场景：

```tsx
<MemoryIcon size={96} strokeWidth={2} absoluteStrokeWidth />
```

Base 与 Emphasis 的可见描边保持一致。Emphasis 的 glyph 会缩放到强调背景内，因此实现层会补偿其组缩放，不要求消费者手动换算描边。

## 6. Base 与 Emphasis

Base 是唯一可编辑的语义几何源。Emphasis 不另画一套图标，而是由生成器组合：

1. 预生成的静态 Emphasis SVG 使用 48×48 画布上的 44 单位圆形背景，作为兼容默认值。
2. React 组件和字符串渲染 API 允许把背景切换为 44×44 圆角矩形，圆角范围为 0–22；默认仍为圆形。
3. Base glyph 以中心点为基准缩放至 78%。
4. 前景色默认白色，背景默认 Sparo red，但两者都可动态覆盖。
5. 描边宽度经过缩放补偿，保证与 Base 的可见线宽一致。

这样能避免两种变体在后续迭代中语义漂移。

## 7. SVG 资产合同

Base SVG 根节点必须包含：

```xml
<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 48 48"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  data-sparo-icon="stable-id"
>
```

约束：

- 不固定 `width`/`height`。
- glyph 内不写 `#hex`、`rgb()` 或独立 `stroke-width`。
- 不嵌入文字、位图、滤镜、mask 或业务状态。
- 不用描边颜色表达唯一状态。
- ID 使用 kebab-case，发布后保持稳定。
- 装饰性图标 `aria-hidden`；承担信息时必须提供 `title` 或 `aria-label`。

## 8. 视觉一致性

- 语义优先：第一眼能识别对象，再考虑品牌椭圆等 Sparo 特征。
- 负空间优先：相邻线段在 48px 输出时至少保留约 2px 屏幕间距。
- 轮廓重心：视觉重量应落在画布中心附近；右箭头等方向性附件可做轻微反向补偿。
- 圆角一致：相似矩形应使用相同半径体系；避免一个图标过圆、另一个过硬。
- 细节克制：当前语言强调“Simple Form · Clear Meaning”，不加入装饰性小点或多余分割线。

## 9. QA 清单

- 48/64/80/96/128px 无裁切、无粘连、无异常尖角。
- Base 与 Emphasis 的语义轮廓完全一致。
- 浅色/深色画布均有足够对比度。
- 默认描边和固定屏幕描边都能正确工作。
- 动态前景/背景色没有被 SVG 内部硬编码覆盖。
- 圆形与圆角矩形强调背景均不裁切 glyph，圆角 0/10/22 三档输出正确。
- Base 与 Emphasis 在预览和横向图库中同时可见，不依赖状态切换才能比较。
- 键盘可以操作预览页的搜索、筛选、滑杆、复制和下载。
- `pnpm run check:icons` 验证母版结构与生成文件同步。
- `pnpm run build:icons` 验证 React 包、类型声明和独立预览均可构建。
