# @sparo/icons

Sparo OS 的独立 SVG 系统图标包。当前包含 12 个系统入口图标、8 个工作类型图标、6 个导航图标、4 个搜索筛选图标、5 个文件传输图标与 9 个编辑管理图标，每个图标都有 `Base` 与 `Emphasis` 两种可复用形态，共 88 个 SVG。

这个包与现有 `src/web-ui/src/design-system/foundation/icons` 隔离，当前应用图标与引用方式保持不变。后续接入 Sparo OS 时，应由 `@/design-system` 统一再导出，避免产品代码直接依赖包内部路径。

## 设计定位

- 母版网格：`48 × 48`，不是 24 网格的运行时放大壳。
- 内容区域：`40 × 40`，四周保留 4 单位安全区。
- 标准描边：`2` 母版单位，圆角端点与圆角连接。
- 推荐输出：`48 / 64 / 80 / 96 / 128px`。
- Base：透明背景，线条继承 `currentColor`。
- Emphasis：同一套语义几何，独立控制前景色、背景色、圆形/圆角矩形背景与描边。
- 小尺寸分工：24px 及以下的通用操作图标继续使用 `lucide-react`；Sparo System Icons 面向大尺寸、品牌化系统入口。

完整规则见 [SPEC.md](./SPEC.md)。

## 目录

```text
src/packages/icons/
├─ scripts/
│  └─ generate-svg-variants.mjs   # 生成 Emphasis 与 sprite，并做结构校验
├─ src/
│  ├─ svg/
│  │  ├─ base/                    # 44 个可编辑的 48×48 SVG 母版
│  │  ├─ emphasis/                # 由 Base 自动生成，不手改
│  │  └─ sparo-system-icons.svg   # 自动生成的 SVG sprite
│  ├─ preview/                    # 独立可交互预览站点
│  ├─ react/                      # 动态组件与具名组件
│  ├─ icon-manifest.ts            # 类型化清单
│  ├─ icon-spec.ts                # 对外公开的尺寸与描边常量
│  ├─ icons.json                  # 图标族、名称、中文、标签与组件名
│  └─ render-system-icon-svg.ts   # 服务端/下载场景的 SVG 字符串 API
├─ SPEC.md                        # 设计、光学尺寸与验收规范
└─ README.md
```

## React 引用

```tsx
import { WorkCenterIcon } from '@sparo/icons';

<WorkCenterIcon size={64} color="currentColor" />

<WorkCenterIcon
  variant="emphasis"
  size={96}
  color="#ffffff"
  backgroundColor="#d9231b"
  backgroundShape="rounded-rect"
  backgroundRadius={10}
  strokeWidth={2}
/>
```

`backgroundShape` 支持 `circle`（默认）与 `rounded-rect`。圆角矩形通过 `backgroundRadius={0..22}` 调整圆角；React 组件和 `renderSystemIconSvg()` 导出的最终 SVG 使用同一套参数。包内预生成的静态 Emphasis SVG 与 sprite 为保持兼容，仍采用默认圆形背景。

运行时名称：

```tsx
import { SparoSystemIcon } from '@sparo/icons';

<SparoSystemIcon name="memory" variant="base" size={80} />
```

像 Lucide 一样，默认 SVG 描边会随图标一起缩放。需要跨尺寸保持相同屏幕描边时：

```tsx
<SparoSystemIcon
  name="files"
  size={128}
  strokeWidth={2}
  absoluteStrokeWidth
/>
```

图标只用于装饰时会自动设置 `aria-hidden`。传入 `title` 或 `aria-label` 后会作为可访问图像输出。

## 原生 SVG 引用

```ts
import filesBaseUrl from '@sparo/icons/svg/base/files.svg';
import filesEmphasisUrl from '@sparo/icons/svg/emphasis/files.svg';
```

也可以使用 sprite：

```html
<svg width="64" height="64" aria-hidden="true">
  <use href="/path/to/sparo-system-icons.svg#files"></use>
</svg>
```

Sprite 中的强调图标 ID 为 `#files-emphasis`。

## 独立预览与校验

从仓库根目录执行：

```text
pnpm run generate:icons
pnpm run check:icons
pnpm run preview:icons
pnpm run build:icons
```

预览页支持图标族筛选、搜索、Base/Emphasis 同屏比较、以 Base 母版浏览图库、48–192px 缩放、推荐尺寸快捷切换、相对/固定描边、前景/背景颜色、圆形/圆角矩形强调背景、圆角调整，以及分变体 SVG 复制和下载。全部参数在右侧属性栏中直接展开。

## 新增图标

1. 按 [SPEC.md](./SPEC.md) 在 `src/svg/base` 增加一个 `48 × 48` SVG 母版。
2. 在 `src/icons.json` 增加稳定 ID、名称、中文与搜索标签。
3. 在 `src/raw-icons.ts` 注册 SVG，在 `src/react/named-icons.tsx` 增加具名组件。
4. 运行 `pnpm run generate:icons`，不要手改 `emphasis` 或 sprite。
5. 在 48、64、80、96、128px 下检查 Base/Emphasis、浅色/深色画布和固定描边模式。
6. 运行 `pnpm run check:icons` 与 `pnpm run build:icons` 后再发布。

## 发布边界

- 包名：`@sparo/icons`
- 稳定名称：图标 ID 与组件名发布后不直接改名，改名需保留一个弃用周期的别名。
- 版本策略：新增图标是 minor；几何优化且语义不变是 patch；删除或改名是 major。
- Tree shaking：React 运行时代码标记为无副作用；消费者只需导入使用的组件。
- 源资产：npm 包同时发布 `dist`、Base/Emphasis SVG、sprite、manifest 与规范文档。
