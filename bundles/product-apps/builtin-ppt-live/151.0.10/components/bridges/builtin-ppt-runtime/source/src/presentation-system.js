const SYSTEM_SCHEMA_VERSION = 1;

const TEXT_ROLES = Object.freeze([
  "cover",
  "title",
  "section",
  "body",
  "label",
  "metric",
  "caption",
  "source",
  "code",
]);

const BASE_COLOR_TOKENS = Object.freeze([
  "canvas",
  "surface",
  "ink",
  "muted",
  "border",
  "primary",
  "accent",
  "positive",
  "caution",
  "negative",
]);

const DEFAULT_PRESENTATION_SYSTEM = Object.freeze({
  schemaVersion: SYSTEM_SCHEMA_VERSION,
  systemId: "editorial-clarity",
  name: "Editorial Clarity",
  rationale: "A calm editorial system with decisive hierarchy, evidence-first layouts, and restrained signal colors.",
  direction: {
    keywords: ["editorial", "precise", "evidence-led", "human"],
    tone: "Confident and direct without feeling corporate or ornamental.",
    audienceFit: "Product, technical, and executive audiences who need to scan claims and evidence quickly.",
    avoid: ["repetitive card grids", "decorative gradients", "tiny text", "single-hue pages", "generic icon walls"],
  },
  color: {
    canvas: { value: "#F4F3F0", purpose: "Warm neutral page field" },
    surface: { value: "#FFFFFF", purpose: "Raised evidence and media surfaces" },
    ink: { value: "#171A1F", purpose: "Primary text and decisive marks" },
    muted: { value: "#555E6B", purpose: "Secondary labels and supporting copy" },
    border: { value: "#D8DADF", purpose: "Quiet structural separators" },
    primary: { value: "#0F766E", purpose: "Primary emphasis and navigation through a page" },
    accent: { value: "#D9472C", purpose: "Sparse contrast signal for the key fact" },
    positive: { value: "#2F855A", purpose: "Positive status and favorable movement" },
    caution: { value: "#B7791F", purpose: "Caution and unresolved trade-offs" },
    negative: { value: "#C2413A", purpose: "Negative status and material risk" },
    dataSeries: [
      { value: "#0F766E", purpose: "Primary series" },
      { value: "#D9472C", purpose: "Comparison or highlighted series" },
      { value: "#4C6FFF", purpose: "Secondary quantitative series" },
      { value: "#8B5CF6", purpose: "Additional quantitative series" },
      { value: "#D4A72C", purpose: "Additional quantitative series" },
    ],
  },
  typography: {
    displayFamily: "Aptos Display",
    bodyFamily: "Aptos",
    monoFamily: "Cascadia Mono",
    cjkFamily: "Microsoft YaHei",
    roles: {
      cover: { family: "display", size: 42, lineHeight: 1.06, weight: 700 },
      title: { family: "display", size: 30, lineHeight: 1.12, weight: 700 },
      section: { family: "display", size: 36, lineHeight: 1.08, weight: 700 },
      body: { family: "body", size: 18, lineHeight: 1.32, weight: 400 },
      label: { family: "body", size: 13, lineHeight: 1.2, weight: 600 },
      metric: { family: "display", size: 46, lineHeight: 1, weight: 700 },
      caption: { family: "body", size: 14, lineHeight: 1.25, weight: 400 },
      source: { family: "body", size: 11, lineHeight: 1.2, weight: 400 },
      code: { family: "mono", size: 15, lineHeight: 1.28, weight: 500 },
    },
  },
  layout: {
    canvas: "16:9",
    safeArea: { top: 6, right: 6, bottom: 6, left: 6 },
    columns: 12,
    gutter: 1.6,
    spacingScale: [1, 2, 3, 5, 8, 13],
    alignmentRules: ["Align evidence to the title grid", "Use one dominant visual axis", "Keep sources on the safe-area baseline"],
    density: "balanced",
  },
  shape: {
    radius: { none: 0, small: 4, medium: 8 },
    strokeWidth: 1,
    borderToken: "border",
    shadow: "subtle",
  },
  media: {
    preferredTreatment: "documentary",
    fit: "contain",
    captionStyle: "Short, factual, and aligned with the evidence edge.",
    screenshotTreatment: "Show the real interface with a quiet border and no decorative device frame.",
  },
  chart: {
    seriesTokens: ["data.1", "data.2", "data.3", "data.4", "data.5"],
    axisStyle: "Quiet axes, direct labels, and no ornamental frame.",
    gridStyle: "Only retain grid lines that support comparison.",
    labelStyle: "Label the evidence directly whenever space allows.",
    highlightStrategy: "Use accent for one decision-relevant series or point.",
  },
  vector: {
    strokeStyle: "Consistent medium strokes with clear joins.",
    iconStyle: "Simple geometric icons with a shared optical weight.",
    connectorStyle: "Direct orthogonal or gently curved connectors; label ambiguous relationships.",
    themeBinding: "semantic-tokens",
  },
  archetypes: [
    { id: "cover", name: "Cover", purpose: "Establish the topic and first visual signal.", composition: "One dominant title with one concrete brand, product, or evidence object." },
    { id: "section", name: "Section", purpose: "Change chapter and rhythm.", composition: "A short section statement with intentional negative space." },
    { id: "statement", name: "Statement", purpose: "Land one judgment or metric.", composition: "One claim dominates; support remains subordinate." },
    { id: "evidence", name: "Evidence", purpose: "Prove a claim with source material.", composition: "Answer-first title plus one legible chart, table, or source object." },
    { id: "comparison", name: "Comparison", purpose: "Make differences immediately scannable.", composition: "Use a shared baseline and visually encode the decisive difference." },
    { id: "process", name: "Process", purpose: "Explain sequence, responsibility, or state change.", composition: "A readable path with explicit direction and few branches." },
    { id: "architecture", name: "Architecture", purpose: "Explain layers, dependencies, and boundaries.", composition: "Use spatial hierarchy and labeled relationships, not stacked dark boxes." },
    { id: "media", name: "Media / Demo", purpose: "Let the real product or object lead.", composition: "The media is the primary evidence, with minimal framing copy." },
    { id: "closing", name: "Closing", purpose: "Conclude and define the next action.", composition: "A memorable conclusion with one concrete action or decision." },
  ],
  quality: {
    minBodySize: 16,
    minLabelSize: 12,
    maxBodyCharacters: 520,
    maxRepeatedComposition: 3,
    minContrastRatio: 4.5,
    requireEvidenceObject: true,
    requireSourceForEvidence: true,
  },
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function objectValue(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function assertKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${name} contains unsupported field '${key}'`);
  }
}

function requiredText(value, name, maxLength = 1000) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
  if (value.length > maxLength) throw new Error(`${name} exceeds ${maxLength} characters`);
  return value.trim();
}

function requiredNumber(value, name, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

function stringList(value, name, min = 1, max = 20) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${name} must contain between ${min} and ${max} items`);
  }
  return value.map((item, index) => requiredText(item, `${name}[${index}]`, 240));
}

function normalizeColorToken(value, name) {
  const token = objectValue(value, name);
  assertKeys(token, new Set(["value", "purpose"]), name);
  const color = requiredText(token.value, `${name}.value`, 7).toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(color)) throw new Error(`${name}.value must be a six-digit hex color`);
  return { value: color, purpose: requiredText(token.purpose, `${name}.purpose`, 180) };
}

function normalizeTypeRole(value, name) {
  const role = objectValue(value, name);
  assertKeys(role, new Set(["family", "size", "lineHeight", "weight"]), name);
  if (!["display", "body", "mono"].includes(role.family)) throw new Error(`${name}.family is unsupported`);
  return {
    family: role.family,
    size: requiredNumber(role.size, `${name}.size`, 8, 96),
    lineHeight: requiredNumber(role.lineHeight, `${name}.lineHeight`, 0.8, 2),
    weight: requiredNumber(role.weight, `${name}.weight`, 100, 900),
  };
}

function normalizePresentationSystem(value) {
  const system = objectValue(value, "presentationSystem");
  assertKeys(system, new Set([
    "schemaVersion", "systemId", "name", "rationale", "direction", "color", "typography",
    "layout", "shape", "media", "chart", "vector", "archetypes", "quality",
  ]), "presentationSystem");
  if (system.schemaVersion !== SYSTEM_SCHEMA_VERSION) throw new Error(`presentationSystem.schemaVersion must be ${SYSTEM_SCHEMA_VERSION}`);
  const systemId = requiredText(system.systemId, "presentationSystem.systemId", 80);
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(systemId)) throw new Error("presentationSystem.systemId must be a stable lowercase id");

  const direction = objectValue(system.direction, "presentationSystem.direction");
  assertKeys(direction, new Set(["keywords", "tone", "audienceFit", "avoid"]), "presentationSystem.direction");

  const color = objectValue(system.color, "presentationSystem.color");
  assertKeys(color, new Set([...BASE_COLOR_TOKENS, "dataSeries"]), "presentationSystem.color");
  const normalizedColor = {};
  for (const key of BASE_COLOR_TOKENS) normalizedColor[key] = normalizeColorToken(color[key], `presentationSystem.color.${key}`);
  if (!Array.isArray(color.dataSeries) || color.dataSeries.length < 3 || color.dataSeries.length > 12) {
    throw new Error("presentationSystem.color.dataSeries must contain between 3 and 12 colors");
  }
  normalizedColor.dataSeries = color.dataSeries.map((token, index) => normalizeColorToken(token, `presentationSystem.color.dataSeries[${index}]`));

  const typography = objectValue(system.typography, "presentationSystem.typography");
  assertKeys(typography, new Set(["displayFamily", "bodyFamily", "monoFamily", "cjkFamily", "roles"]), "presentationSystem.typography");
  const roles = objectValue(typography.roles, "presentationSystem.typography.roles");
  assertKeys(roles, new Set(TEXT_ROLES), "presentationSystem.typography.roles");
  const normalizedRoles = {};
  for (const role of TEXT_ROLES) normalizedRoles[role] = normalizeTypeRole(roles[role], `presentationSystem.typography.roles.${role}`);

  const layout = objectValue(system.layout, "presentationSystem.layout");
  assertKeys(layout, new Set(["canvas", "safeArea", "columns", "gutter", "spacingScale", "alignmentRules", "density"]), "presentationSystem.layout");
  if (layout.canvas !== "16:9") throw new Error("presentationSystem.layout.canvas must be 16:9");
  const safeArea = objectValue(layout.safeArea, "presentationSystem.layout.safeArea");
  assertKeys(safeArea, new Set(["top", "right", "bottom", "left"]), "presentationSystem.layout.safeArea");
  if (!["airy", "balanced", "dense"].includes(layout.density)) throw new Error("presentationSystem.layout.density is unsupported");

  const shape = objectValue(system.shape, "presentationSystem.shape");
  assertKeys(shape, new Set(["radius", "strokeWidth", "borderToken", "shadow"]), "presentationSystem.shape");
  const radius = objectValue(shape.radius, "presentationSystem.shape.radius");
  assertKeys(radius, new Set(["none", "small", "medium"]), "presentationSystem.shape.radius");
  if (!["none", "subtle"].includes(shape.shadow)) throw new Error("presentationSystem.shape.shadow is unsupported");

  const media = objectValue(system.media, "presentationSystem.media");
  assertKeys(media, new Set(["preferredTreatment", "fit", "captionStyle", "screenshotTreatment"]), "presentationSystem.media");
  if (!["full-bleed", "framed", "cutout", "documentary"].includes(media.preferredTreatment)) throw new Error("presentationSystem.media.preferredTreatment is unsupported");
  if (!["cover", "contain"].includes(media.fit)) throw new Error("presentationSystem.media.fit is unsupported");

  const chart = objectValue(system.chart, "presentationSystem.chart");
  assertKeys(chart, new Set(["seriesTokens", "axisStyle", "gridStyle", "labelStyle", "highlightStrategy"]), "presentationSystem.chart");
  const vector = objectValue(system.vector, "presentationSystem.vector");
  assertKeys(vector, new Set(["strokeStyle", "iconStyle", "connectorStyle", "themeBinding"]), "presentationSystem.vector");
  if (vector.themeBinding !== "semantic-tokens") throw new Error("presentationSystem.vector.themeBinding must be semantic-tokens");

  if (!Array.isArray(system.archetypes) || system.archetypes.length < 5 || system.archetypes.length > 20) {
    throw new Error("presentationSystem.archetypes must contain between 5 and 20 page archetypes");
  }
  const archetypes = system.archetypes.map((value, index) => {
    const archetype = objectValue(value, `presentationSystem.archetypes[${index}]`);
    assertKeys(archetype, new Set(["id", "name", "purpose", "composition"]), `presentationSystem.archetypes[${index}]`);
    const id = requiredText(archetype.id, `presentationSystem.archetypes[${index}].id`, 80);
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) throw new Error(`presentationSystem.archetypes[${index}].id must be a stable lowercase id`);
    return { id, name: requiredText(archetype.name, `${id}.name`, 80), purpose: requiredText(archetype.purpose, `${id}.purpose`, 240), composition: requiredText(archetype.composition, `${id}.composition`, 360) };
  });
  if (new Set(archetypes.map((item) => item.id)).size !== archetypes.length) throw new Error("presentationSystem.archetypes contains duplicate ids");

  const quality = objectValue(system.quality, "presentationSystem.quality");
  assertKeys(quality, new Set(["minBodySize", "minLabelSize", "maxBodyCharacters", "maxRepeatedComposition", "minContrastRatio", "requireEvidenceObject", "requireSourceForEvidence"]), "presentationSystem.quality");

  const normalized = {
    schemaVersion: SYSTEM_SCHEMA_VERSION,
    systemId,
    name: requiredText(system.name, "presentationSystem.name", 100),
    rationale: requiredText(system.rationale, "presentationSystem.rationale", 600),
    direction: {
      keywords: stringList(direction.keywords, "presentationSystem.direction.keywords", 2, 12),
      tone: requiredText(direction.tone, "presentationSystem.direction.tone", 360),
      audienceFit: requiredText(direction.audienceFit, "presentationSystem.direction.audienceFit", 360),
      avoid: stringList(direction.avoid, "presentationSystem.direction.avoid", 2, 16),
    },
    color: normalizedColor,
    typography: {
      displayFamily: requiredText(typography.displayFamily, "presentationSystem.typography.displayFamily", 100),
      bodyFamily: requiredText(typography.bodyFamily, "presentationSystem.typography.bodyFamily", 100),
      monoFamily: requiredText(typography.monoFamily, "presentationSystem.typography.monoFamily", 100),
      cjkFamily: requiredText(typography.cjkFamily || "Microsoft YaHei", "presentationSystem.typography.cjkFamily", 100),
      roles: normalizedRoles,
    },
    layout: {
      canvas: "16:9",
      safeArea: {
        top: requiredNumber(safeArea.top, "safeArea.top", 0, 20),
        right: requiredNumber(safeArea.right, "safeArea.right", 0, 20),
        bottom: requiredNumber(safeArea.bottom, "safeArea.bottom", 0, 20),
        left: requiredNumber(safeArea.left, "safeArea.left", 0, 20),
      },
      columns: requiredNumber(layout.columns, "presentationSystem.layout.columns", 2, 24),
      gutter: requiredNumber(layout.gutter, "presentationSystem.layout.gutter", 0, 10),
      spacingScale: (Array.isArray(layout.spacingScale) ? layout.spacingScale : []).map((item, index) => requiredNumber(item, `spacingScale[${index}]`, 0.25, 30)),
      alignmentRules: stringList(layout.alignmentRules, "presentationSystem.layout.alignmentRules", 1, 12),
      density: layout.density,
    },
    shape: {
      radius: {
        none: requiredNumber(radius.none, "radius.none", 0, 100),
        small: requiredNumber(radius.small, "radius.small", 0, 100),
        medium: requiredNumber(radius.medium, "radius.medium", 0, 100),
      },
      strokeWidth: requiredNumber(shape.strokeWidth, "presentationSystem.shape.strokeWidth", 0, 12),
      borderToken: requiredText(shape.borderToken, "presentationSystem.shape.borderToken", 40),
      shadow: shape.shadow,
    },
    media: {
      preferredTreatment: media.preferredTreatment,
      fit: media.fit,
      captionStyle: requiredText(media.captionStyle, "presentationSystem.media.captionStyle", 300),
      screenshotTreatment: requiredText(media.screenshotTreatment, "presentationSystem.media.screenshotTreatment", 300),
    },
    chart: {
      seriesTokens: stringList(chart.seriesTokens, "presentationSystem.chart.seriesTokens", 3, 12),
      axisStyle: requiredText(chart.axisStyle, "presentationSystem.chart.axisStyle", 300),
      gridStyle: requiredText(chart.gridStyle, "presentationSystem.chart.gridStyle", 300),
      labelStyle: requiredText(chart.labelStyle, "presentationSystem.chart.labelStyle", 300),
      highlightStrategy: requiredText(chart.highlightStrategy, "presentationSystem.chart.highlightStrategy", 300),
    },
    vector: {
      strokeStyle: requiredText(vector.strokeStyle, "presentationSystem.vector.strokeStyle", 300),
      iconStyle: requiredText(vector.iconStyle, "presentationSystem.vector.iconStyle", 300),
      connectorStyle: requiredText(vector.connectorStyle, "presentationSystem.vector.connectorStyle", 300),
      themeBinding: "semantic-tokens",
    },
    archetypes,
    quality: {
      minBodySize: requiredNumber(quality.minBodySize, "quality.minBodySize", 12, 32),
      minLabelSize: requiredNumber(quality.minLabelSize, "quality.minLabelSize", 9, 24),
      maxBodyCharacters: requiredNumber(quality.maxBodyCharacters, "quality.maxBodyCharacters", 100, 2000),
      maxRepeatedComposition: requiredNumber(quality.maxRepeatedComposition, "quality.maxRepeatedComposition", 1, 12),
      minContrastRatio: requiredNumber(quality.minContrastRatio, "quality.minContrastRatio", 3, 10),
      requireEvidenceObject: Boolean(quality.requireEvidenceObject),
      requireSourceForEvidence: Boolean(quality.requireSourceForEvidence),
    },
  };

  const validTokens = tokenNames(normalized);
  if (!validTokens.has(normalized.shape.borderToken)) throw new Error("presentationSystem.shape.borderToken is not registered");
  normalized.chart.seriesTokens.forEach((token) => {
    if (!validTokens.has(token)) throw new Error(`presentationSystem.chart series token '${token}' is not registered`);
  });
  return normalized;
}

function tokenNames(system) {
  return new Set([
    ...BASE_COLOR_TOKENS,
    ...system.color.dataSeries.map((_, index) => `data.${index + 1}`),
    "transparent",
  ]);
}

function resolveColor(system, token, fallback = "#171A1F") {
  if (token === "transparent") return "transparent";
  if (typeof token !== "string") return fallback;
  if (token.startsWith("data.")) {
    const index = Number(token.slice(5)) - 1;
    return system.color.dataSeries[index]?.value || fallback;
  }
  return system.color[token]?.value || fallback;
}

function resolveTypeRole(system, role = "body") {
  const resolvedRole = system.typography.roles[role] || system.typography.roles.body;
  const family = resolvedRole.family === "display"
    ? system.typography.displayFamily
    : resolvedRole.family === "mono"
      ? system.typography.monoFamily
      : system.typography.bodyFamily;
  return { ...resolvedRole, familyName: family };
}

function presentationSystemPresets() {
  const definitions = [
    {
      id: "editorial-clarity",
      name: "Editorial Clarity",
      rationale: DEFAULT_PRESENTATION_SYSTEM.rationale,
      keywords: DEFAULT_PRESENTATION_SYSTEM.direction.keywords,
      tone: DEFAULT_PRESENTATION_SYSTEM.direction.tone,
      audienceFit: DEFAULT_PRESENTATION_SYSTEM.direction.audienceFit,
      avoid: DEFAULT_PRESENTATION_SYSTEM.direction.avoid,
      palette: ["#F4F3F0", "#FFFFFF", "#171A1F", "#555E6B", "#D8DADF", "#0F766E", "#D9472C"],
      data: ["#0F766E", "#D9472C", "#4C6FFF", "#8B5CF6", "#D4A72C"],
      density: "balanced",
      media: "documentary",
    },
    {
      id: "signal-room",
      name: "Signal Room",
      rationale: "High-contrast analytical pages for live decision rooms, balanced with warm data signals.",
      keywords: ["analytical", "high-contrast", "decisive", "technical"],
      tone: "Focused and rigorous without becoming a dark dashboard.",
      audienceFit: "Leadership reviews and technical decision meetings.",
      avoid: ["wall-to-wall dark panels", "neon decoration", "dense dashboards"],
      palette: ["#15181D", "#242930", "#F5F4EF", "#B8BEC8", "#3A414C", "#69C7B5", "#F0B84A"],
      data: ["#69C7B5", "#F0B84A", "#7DA7FF", "#E57A9B", "#A38BE8"],
      density: "balanced",
      media: "framed",
    },
    {
      id: "studio-redline",
      name: "Studio Redline",
      rationale: "Sharp white space, disciplined navy structure, and sparse red interventions.",
      keywords: ["studio", "structured", "sharp", "modernist"],
      tone: "Crisp, assertive, and visually economical.",
      audienceFit: "Brand, product, and strategic concept presentations.",
      avoid: ["soft generic cards", "pastel wash", "ornamental shadows"],
      palette: ["#FCFCFD", "#F1F3F6", "#172238", "#5A6577", "#D6DAE2", "#233A63", "#C93F3A"],
      data: ["#233A63", "#C93F3A", "#2C7A7B", "#9B6B9E", "#C28A2C"],
      density: "airy",
      media: "full-bleed",
    },
    {
      id: "field-notes",
      name: "Field Notes",
      rationale: "A human research language with documentary media, forest structure, and annotated evidence.",
      keywords: ["documentary", "observational", "tactile", "clear"],
      tone: "Grounded, warm, and specific.",
      audienceFit: "Research, field studies, discovery, and qualitative product narratives.",
      avoid: ["corporate gloss", "beige monochrome", "stock photography"],
      palette: ["#F5F6F1", "#FFFFFF", "#1D251F", "#59645C", "#D6DAD3", "#315E49", "#B94D35"],
      data: ["#315E49", "#B94D35", "#4B6E9F", "#8A6A8C", "#B18A33"],
      density: "balanced",
      media: "documentary",
    },
  ];
  const colorKeys = ["canvas", "surface", "ink", "muted", "border", "primary", "accent"];
  return definitions.map((definition) => {
    const system = clone(DEFAULT_PRESENTATION_SYSTEM);
    system.systemId = definition.id;
    system.name = definition.name;
    system.rationale = definition.rationale;
    system.direction = {
      keywords: definition.keywords,
      tone: definition.tone,
      audienceFit: definition.audienceFit,
      avoid: definition.avoid,
    };
    colorKeys.forEach((key, index) => {
      system.color[key].value = definition.palette[index];
    });
    system.color.dataSeries = definition.data.map((value, index) => ({
      value,
      purpose: `Data series ${index + 1}`,
    }));
    system.layout.density = definition.density;
    system.media.preferredTreatment = definition.media;
    system.media.fit = definition.media === "full-bleed" ? "cover" : "contain";
    return normalizePresentationSystem(system);
  });
}

module.exports = {
  BASE_COLOR_TOKENS,
  DEFAULT_PRESENTATION_SYSTEM,
  SYSTEM_SCHEMA_VERSION,
  TEXT_ROLES,
  clone,
  normalizePresentationSystem,
  presentationSystemPresets,
  resolveColor,
  resolveTypeRole,
  tokenNames,
};
