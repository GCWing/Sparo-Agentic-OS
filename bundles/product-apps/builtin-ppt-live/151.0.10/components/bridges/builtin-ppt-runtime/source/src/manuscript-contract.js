const MANUSCRIPT_CONTRACT_VERSION = 4;
const MAX_SLIDES = 60;
const ALLOWED_PAGE_ROLES = Object.freeze([
  "cover",
  "section",
  "statement",
  "evidence",
  "comparison",
  "process",
  "architecture",
  "media",
  "closing",
]);
const ALLOWED_VISUAL_MODES = Object.freeze(["native", "diagram", "chart", "media", "custom-vector"]);
const ALLOWED_EXPORT_STRATEGIES = Object.freeze(["native", "native-shapes", "native-chart", "svg", "image"]);
const RESERVED_SLIDE_HEADING = /^##\s+P\d{2,3}\s*\|/mi;

class ManuscriptContractError extends Error {
  constructor(violations) {
    const normalized = Array.isArray(violations) ? violations : [];
    super(formatContractFailure(normalized));
    this.name = "ManuscriptContractError";
    this.code = "manuscript_contract_invalid";
    this.contractVersion = MANUSCRIPT_CONTRACT_VERSION;
    this.violations = normalized;
  }
}

function formatContractFailure(violations) {
  const lines = violations.map((item) => `- ${item.path} [${item.code}]: ${item.message}`);
  return [
    `Presentation document violates ManuscriptContract v${MANUSCRIPT_CONTRACT_VERSION} (${violations.length} issue${violations.length === 1 ? "" : "s"}).`,
    ...lines,
  ].join("\n");
}

function addViolation(violations, code, path, message, extra = {}) {
  violations.push({ code, path, message, ...extra });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function containsEmbeddedHtml(content) {
  return /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/m.test(String(content || ""));
}

function normalizeSingleLine(value, path, violations, options = {}) {
  const maxLength = options.maxLength || 600;
  if (typeof value !== "string" || !value.trim()) {
    addViolation(violations, "required", path, `${options.label || path} is required.`);
    return "";
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maxLength) {
    addViolation(violations, "too_long", path, `${options.label || path} may not exceed ${maxLength} characters.`, {
      maxLength,
      actualLength: normalized.length,
    });
  }
  if (containsEmbeddedHtml(normalized)) {
    addViolation(violations, "embedded_html", path, `${options.label || path} must be pure Markdown without embedded HTML.`);
  }
  return normalized.slice(0, maxLength);
}

function normalizeMultiline(value, path, violations, options = {}) {
  const maxLength = options.maxLength || 12000;
  if (typeof value !== "string" || !value.trim()) {
    if (options.required !== false) addViolation(violations, "required", path, `${options.label || path} is required.`);
    return "";
  }
  const normalized = value.trim().replace(/\r\n/g, "\n");
  if (normalized.length > maxLength) {
    addViolation(violations, "too_long", path, `${options.label || path} may not exceed ${maxLength} characters.`, {
      maxLength,
      actualLength: normalized.length,
    });
  }
  if (containsEmbeddedHtml(normalized)) {
    addViolation(violations, "embedded_html", path, `${options.label || path} must be pure Markdown without embedded HTML.`);
  }
  if (RESERVED_SLIDE_HEADING.test(normalized)) {
    addViolation(violations, "reserved_heading", path, `${options.label || path} may not contain a P01-style slide heading.`);
  }
  return normalized.slice(0, maxLength);
}

function normalizeStringList(value, path, violations, options = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    addViolation(violations, "required", path, `${options.label || path} must contain at least one item.`);
    return [];
  }
  if (value.length > (options.maxItems || 40)) {
    addViolation(violations, "too_many_items", path, `${options.label || path} contains too many items.`, {
      maxItems: options.maxItems || 40,
      actualItems: value.length,
    });
  }
  return value.slice(0, options.maxItems || 40).map((item, index) => normalizeSingleLine(
    item,
    `${path}[${index}]`,
    violations,
    { label: `${options.label || path} item`, maxLength: options.maxLength || 1000 },
  ));
}

function normalizeOptionalSingleLine(value, fallback, maxLength = 500) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function expectedSlideId(index) {
  return `p${String(index + 1).padStart(2, "0")}`;
}

function normalizeStructuredDocuments(manuscriptValue, speakerValue, deckId) {
  const violations = [];
  const manuscript = isPlainObject(manuscriptValue) ? manuscriptValue : {};
  if (!isPlainObject(manuscriptValue)) {
    addViolation(violations, "type", "manuscript", "manuscript must be an object.");
  }
  const slidesValue = Array.isArray(manuscript.slides) ? manuscript.slides : [];
  if (!Array.isArray(manuscript.slides)) {
    addViolation(violations, "type", "manuscript.slides", "manuscript.slides must be an array.");
  } else if (slidesValue.length < 1 || slidesValue.length > MAX_SLIDES) {
    addViolation(violations, "slide_count", "manuscript.slides", `manuscript.slides must contain between 1 and ${MAX_SLIDES} slides.`, {
      minimum: 1,
      maximum: MAX_SLIDES,
      actual: slidesValue.length,
    });
  }

  const slides = slidesValue.slice(0, MAX_SLIDES).map((rawValue, index) => {
    const raw = isPlainObject(rawValue) ? rawValue : {};
    const basePath = `manuscript.slides[${index}]`;
    if (!isPlainObject(rawValue)) addViolation(violations, "type", basePath, `${basePath} must be an object.`);
    const expectedId = expectedSlideId(index);
    const slideId = normalizeSingleLine(raw.slideId, `${basePath}.slideId`, violations, { label: "slideId", maxLength: 5 });
    if (slideId && slideId !== expectedId) {
      addViolation(violations, "slide_order", `${basePath}.slideId`, `Slide ${index + 1} must use stable slideId '${expectedId}'.`, {
        expected: expectedId,
        received: slideId,
      });
    }
    const visualValue = isPlainObject(raw.visualDirection) ? raw.visualDirection : {};
    if (!isPlainObject(raw.visualDirection)) {
      addViolation(violations, "type", `${basePath}.visualDirection`, "visualDirection must be an object.");
    }
    const pageRole = normalizeSingleLine(visualValue.pageRole, `${basePath}.visualDirection.pageRole`, violations, { label: "Page role", maxLength: 40 });
    const visualMode = normalizeSingleLine(visualValue.visualMode, `${basePath}.visualDirection.visualMode`, violations, { label: "Visual mode", maxLength: 40 });
    const exportStrategy = normalizeSingleLine(visualValue.exportStrategy, `${basePath}.visualDirection.exportStrategy`, violations, { label: "Export strategy", maxLength: 40 });
    if (pageRole && !ALLOWED_PAGE_ROLES.includes(pageRole)) {
      addViolation(violations, "unsupported_value", `${basePath}.visualDirection.pageRole`, `Unsupported Page role '${pageRole}'.`, { allowed: ALLOWED_PAGE_ROLES });
    }
    if (visualMode && !ALLOWED_VISUAL_MODES.includes(visualMode)) {
      addViolation(violations, "unsupported_value", `${basePath}.visualDirection.visualMode`, `Unsupported Visual mode '${visualMode}'.`, { allowed: ALLOWED_VISUAL_MODES });
    }
    if (exportStrategy && !ALLOWED_EXPORT_STRATEGIES.includes(exportStrategy)) {
      addViolation(violations, "unsupported_value", `${basePath}.visualDirection.exportStrategy`, `Unsupported Export strategy '${exportStrategy}'.`, { allowed: ALLOWED_EXPORT_STRATEGIES });
    }
    return {
      slideId: expectedId,
      title: normalizeSingleLine(raw.title, `${basePath}.title`, violations, { label: "Slide title", maxLength: 240 }),
      coreClaim: normalizeSingleLine(raw.coreClaim, `${basePath}.coreClaim`, violations, { label: "Core claim", maxLength: 600 }),
      visibleCopy: normalizeStringList(raw.visibleCopy, `${basePath}.visibleCopy`, violations, { label: "Visible copy", maxItems: 24, maxLength: 1000 }),
      evidenceAndSources: normalizeStringList(raw.evidenceAndSources, `${basePath}.evidenceAndSources`, violations, { label: "Evidence and sources", maxItems: 24, maxLength: 1200 }),
      visualDirection: {
        pageRole,
        recipe: normalizeSingleLine(visualValue.recipe, `${basePath}.visualDirection.recipe`, violations, { label: "Recipe", maxLength: 128 }),
        visualMode,
        evidenceObject: normalizeSingleLine(visualValue.evidenceObject, `${basePath}.visualDirection.evidenceObject`, violations, { label: "Evidence object", maxLength: 1000 }),
        exportStrategy,
        artDirection: normalizeSingleLine(visualValue.artDirection, `${basePath}.visualDirection.artDirection`, violations, { label: "Art direction", maxLength: 1600 }),
      },
      speakingObjective: normalizeSingleLine(raw.speakingObjective, `${basePath}.speakingObjective`, violations, { label: "Speaking objective", maxLength: 1000 }),
    };
  });

  const speaker = isPlainObject(speakerValue) ? speakerValue : {};
  if (!isPlainObject(speakerValue)) addViolation(violations, "type", "speakerScript", "speakerScript must be an object.");
  const speakerSlidesValue = Array.isArray(speaker.slides) ? speaker.slides : [];
  if (!Array.isArray(speaker.slides)) addViolation(violations, "type", "speakerScript.slides", "speakerScript.slides must be an array.");
  const bySlideId = new Map();
  speakerSlidesValue.forEach((rawValue, index) => {
    const raw = isPlainObject(rawValue) ? rawValue : {};
    const basePath = `speakerScript.slides[${index}]`;
    if (!isPlainObject(rawValue)) addViolation(violations, "type", basePath, `${basePath} must be an object.`);
    const slideId = normalizeSingleLine(raw.slideId, `${basePath}.slideId`, violations, { label: "slideId", maxLength: 5 });
    if (slideId && bySlideId.has(slideId)) {
      addViolation(violations, "duplicate_slide_id", `${basePath}.slideId`, `speakerScript contains duplicate slideId '${slideId}'.`);
      return;
    }
    bySlideId.set(slideId, {
      slideId,
      suggestedTime: normalizeOptionalSingleLine(raw.suggestedTime, "00:45", 16),
      speakingObjective: normalizeOptionalSingleLine(raw.speakingObjective, "", 1000),
      readAloudScript: normalizeMultiline(raw.readAloudScript, `${basePath}.readAloudScript`, violations, { label: "Read-aloud script", maxLength: 12000 }),
      stageCues: Array.isArray(raw.stageCues)
        ? raw.stageCues.map((item, cueIndex) => normalizeSingleLine(item, `${basePath}.stageCues[${cueIndex}]`, violations, { label: "Stage cue", maxLength: 240 }))
        : [],
      transition: normalizeMultiline(raw.transition, `${basePath}.transition`, violations, { label: "Transition", maxLength: 2000 }),
    });
  });
  if (speakerSlidesValue.length !== slides.length) {
    addViolation(violations, "slide_count_mismatch", "speakerScript.slides", "speakerScript must contain exactly one entry for every manuscript slide.", {
      expected: slides.length,
      received: speakerSlidesValue.length,
    });
  }
  const speakerSlides = slides.map((slide) => {
    const item = bySlideId.get(slide.slideId);
    if (!item) {
      addViolation(violations, "missing_slide", `speakerScript.slides.${slide.slideId}`, `speakerScript is missing stable slideId '${slide.slideId}'.`);
      return {
        slideId: slide.slideId,
        suggestedTime: "00:45",
        speakingObjective: slide.speakingObjective,
        readAloudScript: "",
        stageCues: [],
        transition: "",
      };
    }
    return {
      ...item,
      speakingObjective: item.speakingObjective || slide.speakingObjective,
    };
  });
  for (const slideId of bySlideId.keys()) {
    if (slideId && !slides.some((slide) => slide.slideId === slideId)) {
      addViolation(violations, "unknown_slide", `speakerScript.slides.${slideId}`, `speakerScript references unknown slideId '${slideId}'.`);
    }
  }

  const documents = {
    manuscript: {
      schemaVersion: MANUSCRIPT_CONTRACT_VERSION,
      deckId,
      language: normalizeOptionalSingleLine(manuscript.language, "zh-CN", 32),
      title: normalizeSingleLine(manuscript.title, "manuscript.title", violations, { label: "Presentation title", maxLength: 240 }),
      creativeBrief: {
        audience: normalizeOptionalSingleLine(manuscript.creativeBrief?.audience, "Inferred from the topic and evidence", 600),
        purpose: normalizeOptionalSingleLine(manuscript.creativeBrief?.purpose, "Explain the topic and land one concrete conclusion", 600),
        targetDuration: normalizeOptionalSingleLine(manuscript.creativeBrief?.targetDuration, "Inferred from slide count and audience", 120),
      },
      narrative: {
        opening: normalizeOptionalSingleLine(manuscript.narrative?.opening, "Establish the decision or question.", 800),
        development: normalizeOptionalSingleLine(manuscript.narrative?.development, "Build the case with grounded evidence.", 800),
        closing: normalizeOptionalSingleLine(manuscript.narrative?.closing, "Land the conclusion and next action.", 800),
      },
      slides,
    },
    speakerScript: {
      schemaVersion: MANUSCRIPT_CONTRACT_VERSION,
      deckId,
      language: normalizeOptionalSingleLine(speaker.language, manuscript.language || "zh-CN", 32),
      targetDurationMinutes: Number.isFinite(speaker.targetDurationMinutes)
        ? Math.max(0, Math.min(600, speaker.targetDurationMinutes))
        : 0,
      slides: speakerSlides,
    },
  };
  if (violations.length) throw new ManuscriptContractError(violations);
  return documents;
}

function serializeBulletList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function serializeManuscript(document) {
  const sections = document.slides.map((slide) => `## ${slide.slideId.toUpperCase()} | ${slide.title}
### Core claim
${slide.coreClaim}

### Visible copy
${serializeBulletList(slide.visibleCopy)}

### Evidence and sources
${serializeBulletList(slide.evidenceAndSources)}

### Visual direction
- Page role: ${slide.visualDirection.pageRole}
- Recipe: ${slide.visualDirection.recipe}
- Visual mode: ${slide.visualDirection.visualMode}
- Evidence object: ${slide.visualDirection.evidenceObject}
- Export strategy: ${slide.visualDirection.exportStrategy}
- Art direction: ${slide.visualDirection.artDirection}

### Speaking objective
${slide.speakingObjective}`).join("\n\n");
  return `---
pptManuscriptSchema: ${MANUSCRIPT_CONTRACT_VERSION}
deckId: ${document.deckId}
language: ${document.language}
---

# ${document.title}

## Creative brief
- Audience: ${document.creativeBrief.audience}
- Purpose: ${document.creativeBrief.purpose}
- Target duration: ${document.creativeBrief.targetDuration}

## Narrative
- Opening: ${document.narrative.opening}
- Development: ${document.narrative.development}
- Closing: ${document.narrative.closing}

${sections}
`;
}

function serializeSpeakerScript(document, manuscript) {
  const manuscriptById = new Map(manuscript.slides.map((slide) => [slide.slideId, slide]));
  const sections = document.slides.map((slide) => {
    const manuscriptSlide = manuscriptById.get(slide.slideId);
    const stageCues = slide.stageCues.length ? slide.stageCues.join("\n") : "[No stage cue]";
    return `## ${slide.slideId.toUpperCase()} | ${manuscriptSlide.title}
- Suggested time: ${slide.suggestedTime}
- Speaking objective: ${slide.speakingObjective}

### Read-aloud script
${slide.readAloudScript}

### Stage cues
${stageCues}

### Transition
${slide.transition}`;
  }).join("\n\n");
  return `---
pptSpeakerScriptSchema: ${MANUSCRIPT_CONTRACT_VERSION}
deckId: ${document.deckId}
language: ${document.language}
targetDurationMinutes: ${document.targetDurationMinutes}
---

# ${manuscript.title} | Speaker Script

${sections}
`;
}

function slideSections(content) {
  const source = String(content || "");
  const matches = [...source.matchAll(/^##\s+P(\d{2,3})\s*\|\s*(.+?)\s*$/gm)];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    return {
      position: Number(match[1]),
      slideId: `p${match[1]}`,
      title: match[2].trim(),
      content: source.slice(start, end).trim(),
    };
  });
}

function markdownSubsection(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(content || "").match(new RegExp(`^###\\s+${escaped}\\s*$([\\s\\S]*?)(?=^###\\s+|(?![\\s\\S]))`, "mi"));
  return match ? match[1].trim() : "";
}

function markdownSection(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(content || "").match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "mi"));
  return match ? match[1].trim() : "";
}

function markdownBulletValue(content, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(content || "").match(new RegExp(`^[-*]\\s+${escaped}\\s*:\\s*(.+?)\\s*$`, "mi"));
  return match ? match[1].trim() : "";
}

function markdownBulletItems(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.match(/^[-*]\s+(.+?)\s*$/)?.[1]?.trim() || "")
    .filter(Boolean);
}

function manuscriptTitle(content) {
  const withoutFrontmatter = String(content || "").replace(/^---\s*[\s\S]*?\s*---\s*/m, "");
  return withoutFrontmatter.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() || "";
}

function frontmatterValue(content, key) {
  const frontmatter = String(content || "").match(/^---\s*([\s\S]*?)\s*---\s*/m)?.[1] || "";
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return frontmatter.match(new RegExp(`^${escaped}\\s*:\\s*(.*?)\\s*$`, "mi"))?.[1]?.trim() || "";
}

function inspectManuscriptMarkdown(content) {
  const source = String(content || "");
  const violations = [];
  if (!source.trim()) addViolation(violations, "required", "manuscript", "manuscript must be complete non-empty Markdown.");
  if (containsEmbeddedHtml(source)) addViolation(violations, "embedded_html", "manuscript", "manuscript must be pure Markdown without embedded HTML.");
  const title = manuscriptTitle(source);
  if (!title) addViolation(violations, "required", "manuscript.title", "The manuscript requires one level-one presentation title.");
  const sections = slideSections(source);
  if (sections.length < 1 || sections.length > MAX_SLIDES) {
    addViolation(violations, "slide_count", "manuscript.slides", `manuscript must contain between 1 and ${MAX_SLIDES} ordered P01-style slide sections.`, {
      minimum: 1,
      maximum: MAX_SLIDES,
      actual: sections.length,
    });
  }
  const slides = sections.map((section, index) => {
    const slideId = expectedSlideId(index);
    const basePath = `manuscript.slides[${index}]`;
    if (section.position !== index + 1) {
      addViolation(violations, "slide_order", `${basePath}.slideId`, `Slide ${index + 1} must be numbered ${slideId.toUpperCase()}.`, {
        expected: slideId,
        received: section.slideId,
      });
    }
    const coreClaim = markdownSubsection(section.content, "Core claim");
    const visibleCopyMarkdown = markdownSubsection(section.content, "Visible copy");
    const evidenceMarkdown = markdownSubsection(section.content, "Evidence and sources");
    const visualMarkdown = markdownSubsection(section.content, "Visual direction");
    const speakingObjective = markdownSubsection(section.content, "Speaking objective");
    const requiredSections = [
      ["coreClaim", "Core claim", coreClaim],
      ["visibleCopy", "Visible copy", visibleCopyMarkdown],
      ["evidenceAndSources", "Evidence and sources", evidenceMarkdown],
      ["visualDirection", "Visual direction", visualMarkdown],
      ["speakingObjective", "Speaking objective", speakingObjective],
    ];
    for (const [field, label, value] of requiredSections) {
      if (!value) addViolation(violations, "required", `${basePath}.${field}`, `${slideId.toUpperCase()} is missing '### ${label}'.`);
    }
    const visibleCopy = markdownBulletItems(visibleCopyMarkdown);
    const evidenceAndSources = markdownBulletItems(evidenceMarkdown);
    if (visibleCopyMarkdown && !visibleCopy.length) addViolation(violations, "list_required", `${basePath}.visibleCopy`, "Visible copy must contain at least one Markdown bullet.");
    if (evidenceMarkdown && !evidenceAndSources.length) addViolation(violations, "list_required", `${basePath}.evidenceAndSources`, "Evidence and sources must contain at least one Markdown bullet.");
    const visualDirection = {
      pageRole: markdownBulletValue(visualMarkdown, "Page role"),
      recipe: markdownBulletValue(visualMarkdown, "Recipe"),
      visualMode: markdownBulletValue(visualMarkdown, "Visual mode"),
      evidenceObject: markdownBulletValue(visualMarkdown, "Evidence object"),
      exportStrategy: markdownBulletValue(visualMarkdown, "Export strategy"),
      artDirection: markdownBulletValue(visualMarkdown, "Art direction"),
    };
    for (const [field, label] of [
      ["pageRole", "Page role"],
      ["recipe", "Recipe"],
      ["visualMode", "Visual mode"],
      ["evidenceObject", "Evidence object"],
      ["exportStrategy", "Export strategy"],
      ["artDirection", "Art direction"],
    ]) {
      if (visualMarkdown && !visualDirection[field]) addViolation(violations, "required", `${basePath}.visualDirection.${field}`, `Visual direction is missing '${label}'.`);
    }
    if (visualDirection.pageRole && !ALLOWED_PAGE_ROLES.includes(visualDirection.pageRole)) {
      addViolation(violations, "unsupported_value", `${basePath}.visualDirection.pageRole`, `Unsupported Page role '${visualDirection.pageRole}'.`, { allowed: ALLOWED_PAGE_ROLES });
    }
    if (visualDirection.visualMode && !ALLOWED_VISUAL_MODES.includes(visualDirection.visualMode)) {
      addViolation(violations, "unsupported_value", `${basePath}.visualDirection.visualMode`, `Unsupported Visual mode '${visualDirection.visualMode}'.`, { allowed: ALLOWED_VISUAL_MODES });
    }
    if (visualDirection.exportStrategy && !ALLOWED_EXPORT_STRATEGIES.includes(visualDirection.exportStrategy)) {
      addViolation(violations, "unsupported_value", `${basePath}.visualDirection.exportStrategy`, `Unsupported Export strategy '${visualDirection.exportStrategy}'.`, { allowed: ALLOWED_EXPORT_STRATEGIES });
    }
    return {
      slideId,
      position: index + 1,
      title: section.title,
      coreClaim,
      visibleCopy,
      visibleCopyMarkdown,
      evidenceAndSources,
      evidenceAndSourcesMarkdown: evidenceMarkdown,
      visualDirection,
      speakingObjective,
      sectionSource: `${section.title}\n${section.content}`,
    };
  });
  return {
    document: {
      schemaVersion: Number(frontmatterValue(source, "pptManuscriptSchema")) || MANUSCRIPT_CONTRACT_VERSION,
      deckId: frontmatterValue(source, "deckId"),
      language: frontmatterValue(source, "language") || "zh-CN",
      title,
      creativeBrief: {
        audience: markdownBulletValue(markdownSection(source, "Creative brief"), "Audience"),
        purpose: markdownBulletValue(markdownSection(source, "Creative brief"), "Purpose"),
        targetDuration: markdownBulletValue(markdownSection(source, "Creative brief"), "Target duration"),
      },
      narrative: {
        opening: markdownBulletValue(markdownSection(source, "Narrative"), "Opening"),
        development: markdownBulletValue(markdownSection(source, "Narrative"), "Development"),
        closing: markdownBulletValue(markdownSection(source, "Narrative"), "Closing"),
      },
      slides,
    },
    violations,
  };
}

function inspectSpeakerScriptMarkdown(content, manuscriptDocument) {
  const source = String(content || "");
  const violations = [];
  if (!source.trim()) addViolation(violations, "required", "speakerScript", "speakerScript must be complete non-empty Markdown.");
  if (containsEmbeddedHtml(source)) addViolation(violations, "embedded_html", "speakerScript", "speakerScript must be pure Markdown without embedded HTML.");
  const sections = slideSections(source);
  const expectedSlides = manuscriptDocument?.slides || [];
  if (sections.length !== expectedSlides.length) {
    addViolation(violations, "slide_count_mismatch", "speakerScript.slides", "speakerScript must contain exactly one ordered P01 section for every manuscript slide.", {
      expected: expectedSlides.length,
      received: sections.length,
    });
  }
  const slides = sections.map((section, index) => {
    const basePath = `speakerScript.slides[${index}]`;
    const slideId = expectedSlideId(index);
    if (section.position !== index + 1) {
      addViolation(violations, "slide_order", `${basePath}.slideId`, `Speaker section ${index + 1} must use stable slideId '${slideId}'.`, {
        expected: slideId,
        received: section.slideId,
      });
    }
    const readAloudScript = markdownSubsection(section.content, "Read-aloud script");
    const stageCuesMarkdown = markdownSubsection(section.content, "Stage cues");
    const transition = markdownSubsection(section.content, "Transition");
    if (!readAloudScript) addViolation(violations, "required", `${basePath}.readAloudScript`, `${slideId.toUpperCase()} is missing '### Read-aloud script'.`);
    if (!transition) addViolation(violations, "required", `${basePath}.transition`, `${slideId.toUpperCase()} is missing '### Transition'.`);
    return {
      slideId,
      title: section.title,
      suggestedTime: markdownBulletValue(section.content, "Suggested time") || "00:45",
      speakingObjective: markdownBulletValue(section.content, "Speaking objective") || expectedSlides[index]?.speakingObjective || "",
      readAloudScript,
      stageCues: stageCuesMarkdown.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      transition,
    };
  });
  return {
    document: {
      schemaVersion: Number(frontmatterValue(source, "pptSpeakerScriptSchema")) || MANUSCRIPT_CONTRACT_VERSION,
      deckId: frontmatterValue(source, "deckId"),
      language: frontmatterValue(source, "language") || manuscriptDocument?.language || "zh-CN",
      targetDurationMinutes: Number(frontmatterValue(source, "targetDurationMinutes")) || 0,
      slides,
    },
    violations,
  };
}

function parseManuscriptMarkdown(content) {
  const inspected = inspectManuscriptMarkdown(content);
  if (inspected.violations.length) throw new ManuscriptContractError(inspected.violations);
  return inspected.document;
}

function parsePresentationMarkdown(manuscript, speakerScript) {
  const manuscriptResult = inspectManuscriptMarkdown(manuscript);
  const speakerResult = inspectSpeakerScriptMarkdown(speakerScript, manuscriptResult.document);
  const violations = [...manuscriptResult.violations, ...speakerResult.violations];
  if (violations.length) throw new ManuscriptContractError(violations);
  return { manuscript: manuscriptResult.document, speakerScript: speakerResult.document };
}

function initialStructuredDocuments(deckId) {
  return normalizeStructuredDocuments({
    language: "zh-CN",
    title: "Untitled presentation",
    creativeBrief: {
      audience: "To be defined",
      purpose: "To be defined",
      targetDuration: "To be defined",
    },
    narrative: {
      opening: "Establish the decision or question.",
      development: "Build the case with grounded evidence.",
      closing: "Land the conclusion and next action.",
    },
    slides: [{
      slideId: "p01",
      title: "First slide title",
      coreClaim: "Define the first slide claim.",
      visibleCopy: ["Add only audience-facing copy."],
      evidenceAndSources: ["No external evidence; explicitly framed analysis."],
      visualDirection: {
        pageRole: "cover",
        recipe: "cover-hero",
        visualMode: "native",
        evidenceObject: "The presentation title and one concise positioning statement.",
        exportStrategy: "native",
        artDirection: "Use one decisive title, a quiet supporting line, and a clear reading path.",
      },
      speakingObjective: "Define what the audience should understand.",
    }],
  }, {
    language: "zh-CN",
    targetDurationMinutes: 0,
    slides: [{
      slideId: "p01",
      suggestedTime: "00:45",
      speakingObjective: "Introduce the first claim.",
      readAloudScript: "Write the complete words the speaker can deliver.",
      stageCues: ["[Pause]"],
      transition: "Move naturally to the next slide.",
    }],
  }, deckId);
}

function authoringContract() {
  return {
    schemaVersion: MANUSCRIPT_CONTRACT_VERSION,
    sourceOfTruth: "canonical-markdown",
    agentSubmission: "structured",
    visualAuthorship: "ai-authored-from-manuscript",
    runtimeContentInjection: false,
    semanticAlignmentReview: "whole-deck-ai-comparison",
    slideIdentity: "slideId",
    limits: { minimumSlides: 1, maximumSlides: MAX_SLIDES },
    manuscriptSlideFields: ["slideId", "title", "coreClaim", "visibleCopy", "evidenceAndSources", "visualDirection", "speakingObjective"],
    visualDirectionFields: ["pageRole", "recipe", "visualMode", "evidenceObject", "exportStrategy", "artDirection"],
    speakerSlideFields: ["slideId", "suggestedTime", "speakingObjective", "readAloudScript", "stageCues", "transition"],
    allowedPageRoles: ALLOWED_PAGE_ROLES,
    allowedVisualModes: ALLOWED_VISUAL_MODES,
    allowedExportStrategies: ALLOWED_EXPORT_STRATEGIES,
  };
}

module.exports = {
  ALLOWED_EXPORT_STRATEGIES,
  ALLOWED_PAGE_ROLES,
  ALLOWED_VISUAL_MODES,
  MANUSCRIPT_CONTRACT_VERSION,
  ManuscriptContractError,
  authoringContract,
  containsEmbeddedHtml,
  initialStructuredDocuments,
  normalizeStructuredDocuments,
  parseManuscriptMarkdown,
  parsePresentationMarkdown,
  serializeManuscript,
  serializeSpeakerScript,
  slideSections,
};
