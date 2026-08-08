import { useEffect, useMemo, useRef, useState, type WheelEvent } from 'react';
import {
  renderSystemIconSvg,
  SPARO_ICON_DEFAULT_STROKE_WIDTH,
  SPARO_ICON_EMPHASIS_DEFAULT_CORNER_RADIUS,
  SPARO_ICON_EMPHASIS_MAX_CORNER_RADIUS,
  SPARO_ICON_RENDER_SIZES,
  SPARO_ICON_VIEWBOX_SIZE,
  SparoSystemIcon,
  systemIconManifest,
  type SparoIconBackgroundShape,
  type SystemIconFamily,
  type SystemIconMetadata,
  type SystemIconVariant,
} from '../index';

type PageMode = 'home' | 'catalog';
type FamilyMode = SystemIconFamily | 'all';

const DEFAULT_FOREGROUND = '#181816';
const DEFAULT_EMPHASIS_FOREGROUND = '#ffffff';
const DEFAULT_BACKGROUND = '#e84b38';

const FAMILY_COPY: Record<SystemIconFamily, { label: string; labelEn: string; description: string }> = {
  system: {
    label: '系统图标',
    labelEn: 'System icons',
    description: '产品入口、系统能力与核心对象。',
  },
  'work-type': {
    label: '工作类型',
    labelEn: 'Work types',
    description: '智能工作的模式、节奏与运行语义。',
  },
  navigation: {
    label: '导航图标',
    labelEn: 'Navigation',
    description: '页面、层级与内容区域之间的移动和开合语义。',
  },
  'search-filter': {
    label: '搜索筛选',
    labelEn: 'Search & Filter',
    description: '查找、清除、筛选与排序的数据操作语义。',
  },
  'files-transfer': {
    label: '文件与传输',
    labelEn: 'Files & Transfer',
    description: '目录访问、导入导出、下载安装与复制语义。',
  },
  'edit-manage': {
    label: '编辑与管理',
    labelEn: 'Edit & Manage',
    description: '创建、修改、保存、恢复与重试等管理操作。',
  },
  panels: {
    label: '面板控制',
    labelEn: 'Panels',
    description: '左右与底部面板的开合、展开、停靠、固定和布局恢复语义。',
  },
};

const INITIAL_ICON = systemIconManifest.find((icon) => icon.id === 'memory') ?? systemIconManifest[0];
if (!INITIAL_ICON) {
  throw new Error('Sparo icon manifest is empty.');
}

function downloadSvg(icon: SystemIconMetadata, variant: SystemIconVariant, svg: string) {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${icon.id}-${variant}.svg`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function IconPreviewApp() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const iconRailRef = useRef<HTMLDivElement>(null);
  const [pageMode, setPageMode] = useState<PageMode>('home');
  const [query, setQuery] = useState('');
  const [familyMode, setFamilyMode] = useState<FamilyMode>('all');
  const [size, setSize] = useState<number>(128);
  const [strokeWidth, setStrokeWidth] = useState(SPARO_ICON_DEFAULT_STROKE_WIDTH);
  const [absoluteStrokeWidth, setAbsoluteStrokeWidth] = useState(false);
  const [baseColor, setBaseColor] = useState(DEFAULT_FOREGROUND);
  const [emphasisColor, setEmphasisColor] = useState(DEFAULT_EMPHASIS_FOREGROUND);
  const [backgroundColor, setBackgroundColor] = useState(DEFAULT_BACKGROUND);
  const [backgroundShape, setBackgroundShape] = useState<SparoIconBackgroundShape>('circle');
  const [backgroundRadius, setBackgroundRadius] = useState(SPARO_ICON_EMPHASIS_DEFAULT_CORNER_RADIUS);
  const [selectedIcon, setSelectedIcon] = useState<SystemIconMetadata>(INITIAL_ICON);
  const [copiedVariant, setCopiedVariant] = useState<SystemIconVariant | null>(null);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }

    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const collections = useMemo(() => {
    const families = Array.from(new Set(systemIconManifest.map((icon) => icon.family)));
    return families.map((family) => ({
      id: family,
      icons: systemIconManifest.filter((icon) => icon.family === family),
      ...FAMILY_COPY[family],
    }));
  }, []);

  const filteredIcons = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return systemIconManifest.filter((icon) => {
      if (familyMode !== 'all' && icon.family !== familyMode) return false;
      if (!normalized) return true;
      return [icon.id, icon.componentName, icon.label, icon.labelZh, ...icon.tags]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [familyMode, query]);

  const selectedIndex = filteredIcons.findIndex((icon) => icon.id === selectedIcon.id);

  const selectedSvgByVariant: Record<SystemIconVariant, string> = {
    base: renderSystemIconSvg({
      name: selectedIcon.id,
      variant: 'base',
      size,
      color: baseColor,
      strokeWidth,
      absoluteStrokeWidth,
      title: selectedIcon.label,
    }),
    emphasis: renderSystemIconSvg({
      name: selectedIcon.id,
      variant: 'emphasis',
      size,
      color: emphasisColor,
      backgroundColor,
      backgroundShape,
      backgroundRadius,
      strokeWidth,
      absoluteStrokeWidth,
      title: selectedIcon.label,
    }),
  };

  useEffect(() => {
    if (pageMode !== 'catalog' || filteredIcons.length === 0 || selectedIndex >= 0) return;
    setSelectedIcon(filteredIcons[0]);
  }, [filteredIcons, pageMode, selectedIndex]);

  useEffect(() => {
    if (pageMode !== 'catalog') return;
    const frame = window.requestAnimationFrame(() => {
      const selectedButton = iconRailRef.current?.querySelector<HTMLElement>(`[data-icon-id="${selectedIcon.id}"]`);
      selectedButton?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pageMode, selectedIcon.id, filteredIcons]);

  function openHome() {
    setPageMode('home');
    setQuery('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openCatalog(family: FamilyMode = 'all') {
    setFamilyMode(family);
    if (family !== 'all') {
      const firstIcon = systemIconManifest.find((icon) => icon.family === family);
      if (firstIcon) setSelectedIcon(firstIcon);
    }
    setPageMode('catalog');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function selectFamily(family: FamilyMode) {
    setFamilyMode(family);
    if (family !== 'all') {
      const firstIcon = systemIconManifest.find((icon) => icon.family === family);
      if (firstIcon) setSelectedIcon(firstIcon);
    }
  }

  function selectIcon(icon: SystemIconMetadata) {
    setSelectedIcon(icon);
    setCopiedVariant(null);
  }

  function resetPreview() {
    setSize(128);
    setStrokeWidth(SPARO_ICON_DEFAULT_STROKE_WIDTH);
    setAbsoluteStrokeWidth(false);
    setBaseColor(DEFAULT_FOREGROUND);
    setEmphasisColor(DEFAULT_EMPHASIS_FOREGROUND);
    setBackgroundColor(DEFAULT_BACKGROUND);
    setBackgroundShape('circle');
    setBackgroundRadius(SPARO_ICON_EMPHASIS_DEFAULT_CORNER_RADIUS);
  }

  function selectRelativeIcon(direction: -1 | 1) {
    if (filteredIcons.length === 0) return;
    const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), filteredIcons.length - 1);
    selectIcon(filteredIcons[nextIndex]);
  }

  function handleRailWheel(event: WheelEvent<HTMLDivElement>) {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    event.currentTarget.scrollLeft += event.deltaY;
  }

  async function copySvg(variant: SystemIconVariant) {
    await navigator.clipboard.writeText(selectedSvgByVariant[variant]);
    setCopiedVariant(variant);
    window.setTimeout(() => setCopiedVariant(null), 1600);
  }

  return (
    <div className={`icon-preview${pageMode === 'catalog' ? ' icon-preview--catalog' : ''}`}>
      <header className="icon-preview__topbar">
        <button className="icon-preview__brand" type="button" onClick={openHome}>
          <strong>Sparo OS</strong>
          <span>Icon Atlas</span>
        </button>

        <nav className="icon-preview__primary-nav" aria-label="Primary navigation">
          <button type="button" className={pageMode === 'home' ? 'is-active' : ''} aria-current={pageMode === 'home' ? 'page' : undefined} onClick={openHome}>首页</button>
          <button type="button" className={pageMode === 'catalog' ? 'is-active' : ''} aria-current={pageMode === 'catalog' ? 'page' : undefined} onClick={() => openCatalog()}>图库</button>
        </nav>

        <label className="icon-preview__global-search">
          <span>Search</span>
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              if (nextQuery && pageMode !== 'catalog') setPageMode('catalog');
            }}
            placeholder="搜索名称、语义或标签"
          />
          <kbd>⌘ K</kbd>
        </label>

        <button className="icon-preview__catalog-link" type="button" onClick={() => openCatalog()}>
          浏览 {systemIconManifest.length} 个图标
        </button>
      </header>

      {pageMode === 'home' ? (
        <main className="icon-preview__home">
          <section className="icon-preview__home-hero">
            <div className="icon-preview__home-intro">
              <p>Sparo Icon System · {systemIconManifest.length} icons</p>
              <h1>平静、舒展、清晰的<br />线性图标语言。</h1>
              <span>
                以清楚轮廓和宽松留白建立识别，以连续长线、大半径曲线、圆角端点与开放缺口形成家族特征；
                细节克制，视觉重量稳定。
              </span>
              <div>
                <button type="button" onClick={() => openCatalog()}>进入图库</button>
                <button type="button" onClick={() => openCatalog('work-type')}>查看工作类型</button>
              </div>
            </div>

            <div className="icon-preview__hero-specimen" aria-label="Sparo icon specimens">
              <header>
                <span>Live specimen</span>
                <strong>Base + Emphasis</strong>
              </header>
              <div className="icon-preview__hero-feature icon-preview__hero-comparison">
                <div>
                  <SparoSystemIcon
                    name="sparo-hub"
                    variant="base"
                    size={172}
                    color="#ffffff"
                  />
                  <span>Base</span>
                </div>
                <div>
                  <SparoSystemIcon
                    name="sparo-hub"
                    variant="emphasis"
                    size={172}
                    color="#ffffff"
                    backgroundColor={DEFAULT_BACKGROUND}
                  />
                  <span>Emphasis</span>
                </div>
              </div>
            </div>
          </section>

          <section className="icon-preview__home-facts" aria-label="Icon system summary">
            <div><strong>{systemIconManifest.length}</strong><span>Icons</span></div>
            <div><strong>{systemIconManifest.length * 2}</strong><span>Variants</span></div>
            <div><strong>{SPARO_ICON_VIEWBOX_SIZE} × {SPARO_ICON_VIEWBOX_SIZE}</strong><span>Vector master</span></div>
            <div><strong>SVG</strong><span>React + raw assets</span></div>
          </section>

          <section className="icon-preview__home-collections">
            <header>
              <div>
                <p>Collections</p>
                <h2>从集合开始浏览</h2>
              </div>
              <span>集合由图标元数据自动生成，未来新增分类无需重新设计首页结构。</span>
            </header>

            <div className="icon-preview__collection-list">
              {collections.map((collection) => (
                <button key={collection.id} type="button" onClick={() => openCatalog(collection.id)}>
                  <span className="icon-preview__collection-name">
                    <small>{collection.labelEn}</small>
                    <strong>{collection.label}</strong>
                    <em>{collection.icons.length} icons</em>
                  </span>
                  <span className="icon-preview__collection-preview" aria-hidden="true">
                    {collection.icons.slice(0, 5).map((icon) => (
                      <SparoSystemIcon key={icon.id} name={icon.id} variant="base" size={64} color={DEFAULT_FOREGROUND} />
                    ))}
                  </span>
                  <span className="icon-preview__collection-action">打开集合</span>
                </button>
              ))}
            </div>
          </section>

        </main>
      ) : (
        <main className="icon-preview__catalog-page">
          <header className="icon-preview__catalog-toolbar">
            <button className="icon-preview__catalog-back" type="button" onClick={openHome}>← 首页</button>
            <div className="icon-preview__catalog-title">
              <strong>{familyMode === 'all' ? '完整图库' : FAMILY_COPY[familyMode].label}</strong>
              <span>{filteredIcons.length} icons</span>
            </div>
            <nav className="icon-preview__collection-tabs" aria-label="Icon collections">
              <button type="button" className={familyMode === 'all' ? 'is-active' : ''} aria-current={familyMode === 'all' ? 'page' : undefined} onClick={() => selectFamily('all')}>
                全部 <span>{systemIconManifest.length}</span>
              </button>
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  className={familyMode === collection.id ? 'is-active' : ''}
                  aria-current={familyMode === collection.id ? 'page' : undefined}
                  onClick={() => selectFamily(collection.id)}
                >
                  {collection.label} <span>{collection.icons.length}</span>
                </button>
              ))}
            </nav>
          </header>

          {filteredIcons.length > 0 ? (
            <>
              <section className="icon-preview__catalog-stage" aria-label="Selected icon preview" aria-live="polite">
                <div className="icon-preview__stage-main">
                  <header className="icon-preview__stage-heading">
                    <div>
                      <span>Selected icon · {String(selectedIndex + 1).padStart(2, '0')} / {String(filteredIcons.length).padStart(2, '0')}</span>
                      <h1>{selectedIcon.labelZh}</h1>
                      <p>{selectedIcon.label} · {selectedIcon.id}</p>
                    </div>
                    <span className="icon-preview__compare-label">Base + Emphasis</span>
                  </header>

                  <div className="icon-preview__stage-specimens">
                    <article className="icon-preview__stage-specimen">
                      <header><strong>Base</strong><span>Transparent</span></header>
                      <div>
                        <SparoSystemIcon
                          name={selectedIcon.id}
                          variant="base"
                          size={Math.min(size + 64, 248)}
                          strokeWidth={strokeWidth}
                          absoluteStrokeWidth={absoluteStrokeWidth}
                          color={baseColor}
                        />
                      </div>
                      <footer>
                        <small>{size}px · {strokeWidth.toFixed(1)} stroke</small>
                        <div>
                          <button type="button" onClick={() => copySvg('base')}>{copiedVariant === 'base' ? '已复制' : '复制'}</button>
                          <button type="button" onClick={() => downloadSvg(selectedIcon, 'base', selectedSvgByVariant.base)}>下载</button>
                        </div>
                      </footer>
                    </article>

                    <article className="icon-preview__stage-specimen is-emphasis">
                      <header><strong>Emphasis</strong><span>{backgroundShape === 'circle' ? 'Circle' : `Rounded · ${backgroundRadius}`}</span></header>
                      <div>
                        <SparoSystemIcon
                          name={selectedIcon.id}
                          variant="emphasis"
                          size={Math.min(size + 64, 248)}
                          strokeWidth={strokeWidth}
                          absoluteStrokeWidth={absoluteStrokeWidth}
                          color={emphasisColor}
                          backgroundColor={backgroundColor}
                          backgroundShape={backgroundShape}
                          backgroundRadius={backgroundRadius}
                        />
                      </div>
                      <footer>
                        <small>{size}px · {strokeWidth.toFixed(1)} stroke</small>
                        <div>
                          <button type="button" onClick={() => copySvg('emphasis')}>{copiedVariant === 'emphasis' ? '已复制' : '复制'}</button>
                          <button type="button" onClick={() => downloadSvg(selectedIcon, 'emphasis', selectedSvgByVariant.emphasis)}>下载</button>
                        </div>
                      </footer>
                    </article>
                  </div>
                </div>

                <aside className="icon-preview__stage-panel">
                  <header className="icon-preview__properties-heading">
                    <div>
                      <strong>预览参数</strong>
                      <code>{selectedIcon.componentName}</code>
                    </div>
                    <button type="button" onClick={resetPreview}>重置</button>
                  </header>

                  <section className="icon-preview__property-section">
                    <header>
                      <strong>尺寸</strong>
                      <output>{size}px</output>
                    </header>
                    <label className="icon-preview__range">
                      <span className="sr-only">图标尺寸</span>
                      <input type="range" min="48" max="192" step="8" value={size} onChange={(event) => setSize(Number(event.target.value))} />
                    </label>
                    <div className="icon-preview__presets">
                      {SPARO_ICON_RENDER_SIZES.map((preset) => (
                        <button key={preset} type="button" className={size === preset ? 'is-active' : ''} onClick={() => setSize(preset)}>{preset}</button>
                      ))}
                    </div>
                  </section>

                  <section className="icon-preview__property-section">
                    <header>
                      <strong>描边</strong>
                      <output>{strokeWidth.toFixed(1)}</output>
                    </header>
                    <label className="icon-preview__range">
                      <span className="sr-only">描边宽度</span>
                      <input type="range" min="1.5" max="4" step="0.1" value={strokeWidth} onChange={(event) => setStrokeWidth(Number(event.target.value))} />
                    </label>
                    <label className="icon-preview__property-toggle">
                      <span>
                        <strong>固定屏幕描边</strong>
                        <small>跨尺寸保持相同线宽</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={absoluteStrokeWidth}
                        onChange={(event) => setAbsoluteStrokeWidth(event.target.checked)}
                      />
                    </label>
                  </section>

                  <section className="icon-preview__property-section">
                    <header>
                      <strong>强调背景</strong>
                      <output>{backgroundShape === 'circle' ? '圆形' : '圆角矩形'}</output>
                    </header>
                    <div className="icon-preview__shape-switch" aria-label="Emphasis background shape">
                      <button type="button" className={backgroundShape === 'circle' ? 'is-active' : ''} aria-pressed={backgroundShape === 'circle'} onClick={() => setBackgroundShape('circle')}>圆形</button>
                      <button type="button" className={backgroundShape === 'rounded-rect' ? 'is-active' : ''} aria-pressed={backgroundShape === 'rounded-rect'} onClick={() => setBackgroundShape('rounded-rect')}>圆角矩形</button>
                    </div>
                    {backgroundShape === 'rounded-rect' ? (
                      <label className="icon-preview__range">
                        <span>圆角半径 <b>{backgroundRadius}</b></span>
                        <input type="range" min="0" max={SPARO_ICON_EMPHASIS_MAX_CORNER_RADIUS} step="1" value={backgroundRadius} onChange={(event) => setBackgroundRadius(Number(event.target.value))} />
                      </label>
                    ) : null}
                  </section>

                  <section className="icon-preview__property-section">
                    <header>
                      <strong>颜色</strong>
                    </header>
                    <div className="icon-preview__colors">
                      <label><span>基础线条</span><input aria-label="Base line color" type="color" value={baseColor} onChange={(event) => setBaseColor(event.target.value)} /><b>{baseColor.toUpperCase()}</b></label>
                      <label><span>强调线条</span><input aria-label="Emphasis line color" type="color" value={emphasisColor} onChange={(event) => setEmphasisColor(event.target.value)} /><b>{emphasisColor.toUpperCase()}</b></label>
                      <label><span>强调背景</span><input aria-label="Emphasis background color" type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} /><b>{backgroundColor.toUpperCase()}</b></label>
                    </div>
                  </section>
                </aside>
              </section>

              <section className="icon-preview__rail-section" aria-label="Icon browser">
                <header className="icon-preview__rail-heading">
                  <strong>浏览图标</strong>
                  <span>{filteredIcons.length} 个图标 · 左右滑动浏览</span>
                </header>

                <div className="icon-preview__rail-shell">
                  <button
                    className="icon-preview__rail-arrow"
                    type="button"
                    aria-label="上一个图标"
                    disabled={selectedIndex <= 0}
                    onClick={() => selectRelativeIcon(-1)}
                  >
                    ←
                  </button>
                  <div
                    ref={iconRailRef}
                    className="icon-preview__rail-track"
                    tabIndex={0}
                    onWheel={handleRailWheel}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                        event.preventDefault();
                        selectRelativeIcon(event.key === 'ArrowLeft' ? -1 : 1);
                      }
                    }}
                  >
                    {filteredIcons.map((icon) => {
                      const isSelected = selectedIcon.id === icon.id;
                      return (
                        <button
                          key={icon.id}
                          type="button"
                          data-icon-id={icon.id}
                          className={`icon-preview__rail-item${isSelected ? ' is-selected' : ''}`}
                          aria-pressed={isSelected}
                          onClick={() => selectIcon(icon)}
                        >
                          <span className="icon-preview__rail-artboard">
                            <SparoSystemIcon
                              name={icon.id}
                              variant="base"
                              size={58}
                              strokeWidth={strokeWidth}
                              absoluteStrokeWidth={absoluteStrokeWidth}
                              color={baseColor}
                            />
                          </span>
                          <span className="icon-preview__rail-copy">
                            <strong>{icon.labelZh}</strong>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    className="icon-preview__rail-arrow"
                    type="button"
                    aria-label="下一个图标"
                    disabled={selectedIndex >= filteredIcons.length - 1}
                    onClick={() => selectRelativeIcon(1)}
                  >
                    →
                  </button>
                </div>
              </section>
            </>
          ) : (
            <div className="icon-preview__empty">
              <strong>没有找到匹配的图标</strong>
              <span>尝试使用名称、语义或中文标签搜索。</span>
              <button type="button" onClick={() => setQuery('')}>清除搜索</button>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
