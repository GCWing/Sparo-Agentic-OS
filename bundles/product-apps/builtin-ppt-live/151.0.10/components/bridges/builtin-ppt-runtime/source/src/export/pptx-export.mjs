import pptxgen from 'pptxgenjs';

const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

function systemColor(system, token = 'ink') {
  if (token === 'transparent') return 'transparent';
  if (String(token).startsWith('data.')) {
    return system.color.dataSeries[Number(String(token).slice(5)) - 1]?.value || system.color.primary.value;
  }
  return system.color[token]?.value || system.color.ink.value;
}

function hex(value) {
  return String(value || '#171A1F').replace(/^#/, '').toUpperCase();
}

function typeRole(system, role = 'body') {
  const value = system.typography.roles[role] || system.typography.roles.body;
  const familyName = value.family === 'display'
    ? system.typography.displayFamily
    : value.family === 'mono'
      ? system.typography.monoFamily
      : system.typography.bodyFamily;
  return { ...value, familyName };
}

function createDeck(deck, system) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'PPT Live';
  pptx.subject = deck.title || 'PPT Live presentation';
  pptx.title = deck.title || 'PPT Live';
  pptx.company = 'Sparo OS';
  pptx.lang = 'zh-CN';
  pptx.theme = {
    headFontFace: system.typography.displayFamily,
    bodyFontFace: system.typography.bodyFamily,
    lang: 'zh-CN',
  };
  return pptx;
}

function opacityToTransparency(opacity) {
  return Math.round((1 - Math.max(0, Math.min(1, Number(opacity ?? 1)))) * 100);
}

function percent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0)) / 100;
}

function toInches(element) {
  const source = element.box || element;
  return {
    x: percent(source.x) * SLIDE_W,
    y: percent(source.y) * SLIDE_H,
    w: Math.max(0.08, percent(source.w) * SLIDE_W),
    h: Math.max(0.08, percent(source.h) * SLIDE_H),
  };
}

function textOptions(element, system, fallbackRole = 'body') {
  const style = element.style || {};
  const role = style.fontFamily
    ? { familyName: style.fontFamily, size: style.fontSize, weight: style.fontWeight, lineHeight: style.lineHeight }
    : typeRole(system, style.textRole || fallbackRole);
  const color = style.color || systemColor(system, style.colorToken || 'ink');
  return {
    ...toInches(element),
    margin: style.padding === undefined ? 0 : Math.min(0.4, Number(style.padding) / 72),
    fit: 'shrink',
    color: hex(color),
    fontFace: role.familyName,
    fontSize: role.size,
    bold: role.weight >= 700,
    align: style.align || 'left',
    valign: style.valign === 'middle' ? 'mid' : style.valign || 'top',
    breakLine: false,
    transparency: opacityToTransparency(style.opacity),
  };
}

function shapeLine(style, system) {
  const stroke = style.stroke || systemColor(system, style.strokeToken || system.shape.borderToken);
  return {
    color: hex(stroke === 'transparent' ? '#000000' : stroke),
    transparency: stroke === 'transparent' || style.strokeToken === 'transparent' ? 100 : opacityToTransparency(style.opacity),
    width: Math.max(0.25, Number(style.strokeWidth ?? system.shape.strokeWidth)),
    dash: style.dash || 'solid',
  };
}

function drawChart(pptx, slide, element, system) {
  const box = toInches(element);
  const role = element.style?.fontFamily
    ? { familyName: element.style.fontFamily, size: element.style.fontSize }
    : typeRole(system, element.style?.textRole || 'label');
  slide.addChart(pptx.ChartType.bar, [{
    name: element.text,
    labels: element.data.map((point) => String(point.label)),
    values: element.data.map((point) => Number(point.value)),
  }], {
    ...box,
    barDir: 'col',
    chartColors: (element.seriesColors || system.chart.seriesTokens.map((token) => systemColor(system, token))).map(hex),
    showLegend: false,
    showTitle: Boolean(element.text),
    title: element.text || '',
    titleColor: hex(element.style?.color || systemColor(system, element.style?.colorToken || 'ink')),
    titleFontFace: role.familyName,
    titleFontSize: role.size,
    showValue: true,
    showCatName: false,
    showSerName: false,
    catAxisLabelColor: hex(systemColor(system, 'muted')),
    catAxisLabelFontFace: system.typography.bodyFamily,
    catAxisLabelFontSize: system.typography.roles.caption.size,
    catAxisLineShow: false,
    valAxisLabelColor: hex(systemColor(system, 'muted')),
    valAxisLabelFontFace: system.typography.bodyFamily,
    valAxisLabelFontSize: system.typography.roles.source.size,
    valAxisLineShow: false,
    valGridLine: { color: hex(systemColor(system, 'border')), transparency: 30, width: 0.5 },
    dataLabelColor: hex(systemColor(system, 'ink')),
    dataLabelPosition: 'outEnd',
    dataLabelFormatCode: '0.##',
    border: { color: hex(systemColor(system, 'border')), transparency: 100 },
  });
}

function drawElement(pptx, slide, element, system) {
  const box = toInches(element);
  const style = element.style || {};

  if (element.type === 'shape') {
    const shapeType = element.shape === 'ellipse'
      ? pptx.ShapeType.ellipse
      : element.shape === 'rect'
        ? pptx.ShapeType.rect
        : pptx.ShapeType.roundRect;
    slide.addShape(shapeType, {
      ...box,
      rectRadius: Number(style.radius ?? system.shape.radius[style.radiusRole || 'small']) / 72,
      fill: {
        color: hex((style.fill || systemColor(system, style.fillToken || 'surface')) === 'transparent' ? '#000000' : (style.fill || systemColor(system, style.fillToken || 'surface'))),
        transparency: style.fill === 'transparent' || style.fillToken === 'transparent' ? 100 : opacityToTransparency(style.opacity),
      },
      line: shapeLine(style, system),
    });
    if (element.text) slide.addText(String(element.text), textOptions(element, system, 'label'));
    return;
  }

  if (element.type === 'line') {
    slide.addShape(pptx.ShapeType.line, {
      ...box,
      line: shapeLine({ ...style, strokeToken: style.strokeToken || 'primary' }, system),
    });
    return;
  }

  if (element.type === 'chart') {
    drawChart(pptx, slide, element, system);
    return;
  }

  if (element.type === 'image' || element.type === 'svg') {
    if (!element.assetData) throw new Error(`Visual asset '${element.assetId}' was not hydrated for export`);
    slide.addImage({ data: element.assetData, ...box });
    return;
  }

  if (element.type === 'table') {
    const role = style.fontFamily
      ? { familyName: style.fontFamily, size: style.fontSize, weight: style.fontWeight }
      : typeRole(system, style.textRole || 'body');
    slide.addTable(element.rows.map((row) => row.map((cell) => ({ text: String(cell) }))), {
      ...box,
      border: { type: 'solid', color: hex(style.stroke || systemColor(system, style.strokeToken || 'border')), pt: style.strokeWidth ?? system.shape.strokeWidth },
      fill: { color: hex(style.fill || systemColor(system, style.fillToken || 'surface')) },
      color: hex(style.color || systemColor(system, style.colorToken || 'ink')),
      fontFace: role.familyName,
      fontSize: role.size,
      bold: role.weight >= 700,
      margin: 0.06,
      autoFit: false,
    });
    return;
  }

  const resolvedFill = style.fill || (style.fillToken ? systemColor(system, style.fillToken) : 'transparent');
  if (resolvedFill !== 'transparent') {
    slide.addShape(pptx.ShapeType.rect, {
      ...box,
      fill: { color: hex(resolvedFill), transparency: opacityToTransparency(style.opacity) },
      line: { color: hex(resolvedFill), transparency: 100 },
    });
  }
  slide.addText(String(element.text || ''), textOptions(element, system));
}

function speakerNotes(sourceSlide) {
  return [
    sourceSlide.notes,
    sourceSlide.claim ? `Claim: ${sourceSlide.claim}` : '',
    sourceSlide.evidenceObject ? `Evidence object: ${sourceSlide.evidenceObject}` : '',
    sourceSlide.sourceNote ? `Source note: ${sourceSlide.sourceNote}` : '',
  ].filter(Boolean).join('\n\n');
}

function safeFilename(value) {
  return String(value || 'presentation').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 96);
}

export async function exportPptxFromDeck(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const system = deck?.presentationSystem;
  if (!slides.length) throw new Error('Create at least one slide before exporting');
  if (!system?.color || !system?.typography) throw new Error('PresentationSystem was not hydrated for export');

  const pptx = createDeck(deck, system);
  slides.forEach((sourceSlide) => {
    const slide = pptx.addSlide();
    slide.background = { color: hex(sourceSlide.renderTree?.canvas?.background || systemColor(system, 'canvas')) };
    [...(sourceSlide.renderTree?.nodes || sourceSlide.elements || [])]
      .sort((left, right) => Number(left.z || 0) - Number(right.z || 0))
      .forEach((element) => drawElement(pptx, slide, element, system));
    const notes = speakerNotes(sourceSlide);
    if (notes && typeof slide.addNotes === 'function') slide.addNotes(notes);
  });

  const base64 = await pptx.write({ outputType: 'base64' });
  return {
    filename: `${safeFilename(deck.title)}.pptx`,
    mimeType: MIME_PPTX,
    base64: String(base64 || '').replace(/^data:.*;base64,/, ''),
  };
}
