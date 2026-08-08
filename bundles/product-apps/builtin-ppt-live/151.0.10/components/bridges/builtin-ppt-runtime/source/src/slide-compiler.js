const {
  TEXT_ROLES,
  resolveColor,
  resolveTypeRole,
  tokenNames,
} = require("./presentation-system");
const {
  SLIDE_COMPILER_VERSION,
  defaultRecipeId,
  recipeById,
} = require("./design-package");

const SLOT_ELEMENT_TYPES = new Set(["text", "shape", "line", "image", "svg", "chart", "table"]);
const STYLE_KEYS = new Set([
  "textRole", "colorToken", "fillToken", "strokeToken", "radiusRole", "opacity",
  "align", "valign", "strokeWidth", "dash", "padding",
]);

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

function optionalText(value, maxLength = 4000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function requiredNumber(value, name, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

function compositionContractError(violations) {
  const error = new Error(
    `composition is invalid (${violations.length} issue${violations.length === 1 ? "" : "s"}): ` +
    violations.map((violation) => `${violation.path}: ${violation.message}`).join("; "),
  );
  error.code = "ppt_composition_invalid";
  error.contractVersion = 1;
  error.violations = violations;
  return error;
}

function normalizeSlotStyle(value, name, presentationSystem) {
  if (value === undefined) return {};
  const style = objectValue(value, name);
  assertKeys(style, STYLE_KEYS, name);
  const colors = tokenNames(presentationSystem);
  const normalized = {};
  for (const key of ["colorToken", "fillToken", "strokeToken"]) {
    if (style[key] === undefined) continue;
    if (!colors.has(style[key])) throw new Error(`${name}.${key} must reference a registered design token`);
    normalized[key] = style[key];
  }
  if (style.textRole !== undefined) {
    if (!TEXT_ROLES.includes(style.textRole)) throw new Error(`${name}.textRole is unsupported`);
    normalized.textRole = style.textRole;
  }
  if (style.radiusRole !== undefined) {
    if (!["none", "small", "medium"].includes(style.radiusRole)) throw new Error(`${name}.radiusRole is unsupported`);
    normalized.radiusRole = style.radiusRole;
  }
  if (style.align !== undefined) {
    if (!["left", "center", "right"].includes(style.align)) throw new Error(`${name}.align is unsupported`);
    normalized.align = style.align;
  }
  if (style.valign !== undefined) {
    if (!["top", "middle", "bottom"].includes(style.valign)) throw new Error(`${name}.valign is unsupported`);
    normalized.valign = style.valign;
  }
  if (style.dash !== undefined) {
    if (!["solid", "dash", "dot"].includes(style.dash)) throw new Error(`${name}.dash is unsupported`);
    normalized.dash = style.dash;
  }
  if (style.opacity !== undefined) normalized.opacity = requiredNumber(style.opacity, `${name}.opacity`, 0, 1);
  if (style.strokeWidth !== undefined) normalized.strokeWidth = requiredNumber(style.strokeWidth, `${name}.strokeWidth`, 0, 24);
  if (style.padding !== undefined) normalized.padding = requiredNumber(style.padding, `${name}.padding`, 0, 100);
  return normalized;
}

function normalizeSlotItem(value, index, recipe, presentationSystem, assets) {
  const name = `composition.slots[${index}]`;
  const item = objectValue(value, name);
  assertKeys(item, new Set([
    "id", "slotId", "type", "text", "shape", "assetId", "alt", "data", "rows", "style",
  ]), name);
  const id = requiredText(item.id, `${name}.id`, 128);
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/.test(id)) throw new Error(`${name}.id must be a stable lowercase id`);
  const slotId = requiredText(item.slotId, `${name}.slotId`, 80);
  const slot = recipe.slots.find((candidate) => candidate.id === slotId);
  if (!slot) throw new Error(`${name}.slotId '${slotId}' is not part of recipe '${recipe.id}'`);
  const type = requiredText(item.type, `${name}.type`, 40);
  if (!SLOT_ELEMENT_TYPES.has(type)) throw new Error(`${name}.type is unsupported`);
  if (!slot.kinds.includes(type)) throw new Error(`${name}.type '${type}' is not allowed in slot '${slotId}'`);
  const normalized = {
    id,
    slotId,
    type,
    style: normalizeSlotStyle(item.style, `${name}.style`, presentationSystem),
  };
  if (type === "text") normalized.text = requiredText(item.text, `${name}.text`, 4000);
  if (type === "shape") {
    normalized.shape = item.shape || "roundRect";
    if (!["rect", "roundRect", "ellipse"].includes(normalized.shape)) throw new Error(`${name}.shape is unsupported`);
    normalized.text = optionalText(item.text, 1200);
  }
  if (type === "line") normalized.text = "";
  if (type === "image" || type === "svg") {
    normalized.assetId = requiredText(item.assetId, `${name}.assetId`, 128);
    const asset = assets.get(normalized.assetId);
    if (!asset) throw new Error(`${name} references missing asset '${normalized.assetId}'`);
    normalized.type = asset.kind === "svg" ? "svg" : "image";
    if (!slot.kinds.includes(normalized.type)) throw new Error(`${name} asset kind is not allowed in slot '${slotId}'`);
    normalized.alt = requiredText(item.alt, `${name}.alt`, 500);
  }
  if (type === "chart") {
    normalized.text = requiredText(item.text, `${name}.text`, 500);
    if (!Array.isArray(item.data) || item.data.length < 2 || item.data.length > 24) {
      throw new Error(`${name}.data must contain between 2 and 24 points`);
    }
    normalized.data = item.data.map((point, pointIndex) => {
      const entry = objectValue(point, `${name}.data[${pointIndex}]`);
      assertKeys(entry, new Set(["label", "value"]), `${name}.data[${pointIndex}]`);
      return {
        label: requiredText(entry.label, `${name}.data[${pointIndex}].label`, 120),
        value: requiredNumber(entry.value, `${name}.data[${pointIndex}].value`, -1e12, 1e12),
      };
    });
  }
  if (type === "table") {
    if (!Array.isArray(item.rows) || item.rows.length < 1 || item.rows.length > 20) {
      throw new Error(`${name}.rows must contain between 1 and 20 rows`);
    }
    normalized.rows = item.rows.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length < 1 || row.length > 12) throw new Error(`${name}.rows[${rowIndex}] is invalid`);
      return row.map((cell, columnIndex) => requiredText(cell, `${name}.rows[${rowIndex}][${columnIndex}]`, 500));
    });
    const width = normalized.rows[0].length;
    if (normalized.rows.some((row) => row.length !== width)) throw new Error(`${name}.rows must use a consistent column count`);
  }
  return normalized;
}

function normalizeComposition(value, recipeId, pageRole, designPackage, presentationSystem, assets) {
  const composition = objectValue(value, "composition");
  assertKeys(composition, new Set(["slots"]), "composition");
  const resolvedRecipeId = recipeId || defaultRecipeId(designPackage, pageRole);
  const recipe = recipeById(designPackage, resolvedRecipeId);
  if (!recipe || recipe.legacy) throw new Error(`Recipe '${resolvedRecipeId || ""}' is unavailable for authored composition`);
  if (!recipe.pageRoles.includes(pageRole)) throw new Error(`Recipe '${recipe.id}' does not support pageRole '${pageRole}'`);
  if (!Array.isArray(composition.slots) || composition.slots.length < 1 || composition.slots.length > 40) {
    throw new Error("composition.slots must contain between 1 and 40 items");
  }
  const slots = [];
  const violations = [];
  for (let index = 0; index < composition.slots.length; index += 1) {
    try {
      slots.push(normalizeSlotItem(composition.slots[index], index, recipe, presentationSystem, assets));
    } catch (error) {
      violations.push({
        code: "invalid_slot_element",
        path: `composition.slots[${index}]`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const duplicateIds = [...new Set(slots.map((item) => item.id).filter((id, index, ids) => ids.indexOf(id) !== index))];
  for (const id of duplicateIds) {
    violations.push({
      code: "duplicate_element_id",
      path: "composition.slots",
      message: `Element id '${id}' is duplicated`,
    });
  }
  for (const slot of recipe.slots) {
    const count = slots.filter((item) => item.slotId === slot.id).length;
    if (slot.required && count === 0) {
      violations.push({
        code: "required_recipe_slot_missing",
        path: "composition.slots",
        message: `Recipe '${recipe.id}' requires slot '${slot.id}'`,
      });
    }
    if (!slot.repeatable && count > 1) {
      violations.push({
        code: "recipe_slot_not_repeatable",
        path: "composition.slots",
        message: `Recipe '${recipe.id}' slot '${slot.id}' accepts one item`,
      });
    }
    if (slot.repeatable && count > 0) {
      if (count < Number(slot.minItems || 1) || count > Number(slot.maxItems || 12)) {
        violations.push({
          code: "recipe_slot_cardinality_invalid",
          path: "composition.slots",
          message: `Recipe '${recipe.id}' slot '${slot.id}' requires ${slot.minItems || 1}-${slot.maxItems || 12} items`,
        });
      }
    }
  }
  if (violations.length) throw compositionContractError(violations);
  return { slots };
}

function solveGroupChildren(group) {
  const children = group.children || [];
  const layout = group.layout || { mode: "freeform" };
  if (layout.mode === "freeform" || layout.mode === "overlay" || !children.length) return children;
  const padding = Number(layout.padding || 0);
  const gap = Number(layout.gap || 0);
  const innerW = Math.max(0.1, 100 - padding * 2);
  const innerH = Math.max(0.1, 100 - padding * 2);
  if (layout.mode === "stack") {
    const height = Math.max(0.1, (innerH - gap * (children.length - 1)) / children.length);
    return children.map((child, index) => ({ ...child, x: padding, y: padding + index * (height + gap), w: innerW, h: height }));
  }
  if (layout.mode === "row") {
    const width = Math.max(0.1, (innerW - gap * (children.length - 1)) / children.length);
    return children.map((child, index) => ({ ...child, x: padding + index * (width + gap), y: padding, w: width, h: innerH }));
  }
  const columns = Math.min(children.length, Math.max(1, Math.round(layout.columns || Math.ceil(Math.sqrt(children.length)))));
  const rows = Math.ceil(children.length / columns);
  const width = Math.max(0.1, (innerW - gap * (columns - 1)) / columns);
  const height = Math.max(0.1, (innerH - gap * (rows - 1)) / rows);
  return children.map((child, index) => ({
    ...child,
    x: padding + (index % columns) * (width + gap),
    y: padding + Math.floor(index / columns) * (height + gap),
    w: width,
    h: height,
  }));
}

function flattenElements(elements, parent = { x: 0, y: 0, w: 100, h: 100 }, inheritedZ = 0, parentId = null) {
  return (elements || []).flatMap((element) => {
    const projected = {
      ...element,
      x: parent.x + parent.w * element.x / 100,
      y: parent.y + parent.h * element.y / 100,
      w: parent.w * element.w / 100,
      h: parent.h * element.h / 100,
      z: inheritedZ + Number(element.z || 0),
      parentId,
    };
    if (element.type === "group") {
      return flattenElements(solveGroupChildren(element), projected, projected.z, element.id);
    }
    return [projected];
  });
}

function boxesForSlot(slot, count) {
  if (!slot.repeatable || count <= 1) return [slot.box];
  const gap = 2;
  if (slot.layout === "stack") {
    const height = Math.max(1, (slot.box.h - gap * (count - 1)) / count);
    return Array.from({ length: count }, (_, index) => ({
      x: slot.box.x,
      y: slot.box.y + index * (height + gap),
      w: slot.box.w,
      h: height,
    }));
  }
  const width = Math.max(1, (slot.box.w - gap * (count - 1)) / count);
  return Array.from({ length: count }, (_, index) => ({
    x: slot.box.x + index * (width + gap),
    y: slot.box.y,
    w: width,
    h: slot.box.h,
  }));
}

function elementsFromComposition(slide, designPackage) {
  const recipe = recipeById(designPackage, slide.recipeId);
  if (!recipe || recipe.legacy) throw new Error(`Slide '${slide.id}' has an unavailable recipe '${slide.recipeId}'`);
  const bySlot = new Map();
  for (const item of slide.composition.slots) {
    const items = bySlot.get(item.slotId) || [];
    items.push(item);
    bySlot.set(item.slotId, items);
  }
  const elements = [];
  let z = 1;
  for (const slot of recipe.slots) {
    const items = bySlot.get(slot.id) || [];
    const boxes = boxesForSlot(slot, items.length);
    items.forEach((item, index) => {
      elements.push({
        ...item,
        ...boxes[index],
        z: z++,
        style: { ...(slot.style || {}), ...(item.style || {}) },
        slotId: slot.id,
        semanticRole: slot.id,
      });
    });
  }
  return elements;
}

function compileStyle(element, presentationSystem) {
  const authored = element.style || {};
  const fallbackRole = element.semanticRole === "title" ? "title" : element.type === "shape" ? "label" : "body";
  const role = resolveTypeRole(presentationSystem, authored.textRole || fallbackRole);
  const textualContent = [element.text, ...(element.rows || []).flat(), ...(element.data || []).map((item) => item.label)].filter(Boolean).join(" ");
  const fontFamily = /[\u2E80-\u9FFF\uF900-\uFAFF]/u.test(textualContent)
    ? presentationSystem.typography.cjkFamily
    : role.familyName;
  const fillToken = authored.fillToken || (element.type === "shape" || element.type === "chart" || element.type === "table" ? "surface" : "transparent");
  const strokeToken = authored.strokeToken || presentationSystem.shape.borderToken;
  const radiusRole = authored.radiusRole || (element.type === "shape" ? "small" : "none");
  return {
    tokens: {
      textRole: authored.textRole || fallbackRole,
      color: authored.colorToken || "ink",
      fill: fillToken,
      stroke: strokeToken,
      radius: radiusRole,
    },
    color: resolveColor(presentationSystem, authored.colorToken || "ink"),
    fill: resolveColor(presentationSystem, fillToken, "transparent"),
    stroke: resolveColor(presentationSystem, strokeToken),
    fontFamily,
    fontSize: role.size,
    fontWeight: role.weight,
    lineHeight: role.lineHeight,
    align: authored.align || "left",
    valign: authored.valign || "top",
    opacity: authored.opacity ?? 1,
    strokeWidth: authored.strokeWidth ?? presentationSystem.shape.strokeWidth,
    dash: authored.dash || "solid",
    padding: authored.padding ?? 0,
    radius: presentationSystem.shape.radius[radiusRole] ?? 0,
  };
}

function compileNode(element, presentationSystem) {
  const node = {
    id: element.id,
    type: element.type,
    box: { x: element.x, y: element.y, w: element.w, h: element.h },
    z: Number(element.z || 0),
    parentId: element.parentId || null,
    slotId: element.slotId || null,
    semanticRole: element.semanticRole || null,
    style: compileStyle(element, presentationSystem),
  };
  for (const key of ["text", "shape", "assetId", "alt", "data", "rows"]) {
    if (element[key] !== undefined) node[key] = element[key];
  }
  if (element.type === "chart") {
    node.seriesColors = presentationSystem.chart.seriesTokens.map((token) => resolveColor(presentationSystem, token));
  }
  if (element.type === "image" || element.type === "svg") {
    node.fit = presentationSystem.media.fit;
  }
  return node;
}

function compileSlide(slide, presentationSystem, designPackage, designHash = "") {
  const recipeId = slide.layoutMode === "recipe"
    ? slide.recipeId || defaultRecipeId(designPackage, slide.pageRole)
    : "legacy-freeform";
  const authoredElements = slide.layoutMode === "recipe"
    ? elementsFromComposition({ ...slide, recipeId }, designPackage)
    : flattenElements(slide.elements || []);
  return {
    schemaVersion: 1,
    compilerVersion: SLIDE_COMPILER_VERSION,
    slideId: slide.id,
    slideRevision: Number(slide.revision || 0),
    recipeId,
    layoutMode: slide.layoutMode || "custom",
    designPackageId: designPackage.packageId,
    designPackageRevision: designPackage.revision,
    designHash,
    canvas: {
      width: 1600,
      height: 900,
      aspectRatio: "16:9",
      background: resolveColor(presentationSystem, "canvas"),
      safeArea: { ...presentationSystem.layout.safeArea },
    },
    nodes: authoredElements.map((element) => compileNode(element, presentationSystem))
      .sort((left, right) => left.z - right.z),
  };
}

module.exports = {
  SLOT_ELEMENT_TYPES,
  compileSlide,
  normalizeComposition,
};
