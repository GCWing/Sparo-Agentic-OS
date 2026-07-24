const { clone } = require("./presentation-system");

const DESIGN_PACKAGE_SCHEMA_VERSION = 1;
const SLIDE_COMPILER_VERSION = "1.0.0";

const RECIPE_DEFINITIONS = Object.freeze([
  {
    id: "cover-hero",
    name: "Cover hero",
    pageRoles: ["cover"],
    purpose: "Open with one decisive message and one grounded visual signal.",
    slots: [
      { id: "title", required: true, kinds: ["text"], box: { x: 7, y: 17, w: 56, h: 30 }, style: { textRole: "cover", colorToken: "ink", valign: "middle" } },
      { id: "subtitle", kinds: ["text"], box: { x: 7, y: 51, w: 49, h: 15 }, style: { textRole: "body", colorToken: "muted" } },
      { id: "media", kinds: ["image", "svg", "shape"], box: { x: 66, y: 12, w: 28, h: 70 }, style: { fillToken: "surface", strokeToken: "border", radiusRole: "medium" } },
      { id: "source", kinds: ["text"], box: { x: 7, y: 88, w: 50, h: 5 }, style: { textRole: "source", colorToken: "muted" } },
    ],
  },
  {
    id: "section-statement",
    name: "Section statement",
    pageRoles: ["section"],
    purpose: "Change chapter and rhythm with a short, memorable statement.",
    slots: [
      { id: "label", kinds: ["text"], box: { x: 8, y: 18, w: 30, h: 8 }, style: { textRole: "label", colorToken: "primary" } },
      { id: "title", required: true, kinds: ["text"], box: { x: 8, y: 31, w: 74, h: 34 }, style: { textRole: "section", colorToken: "ink", valign: "middle" } },
      { id: "support", kinds: ["text"], box: { x: 8, y: 70, w: 54, h: 12 }, style: { textRole: "body", colorToken: "muted" } },
    ],
  },
  {
    id: "statement-focus",
    name: "Statement focus",
    pageRoles: ["statement"],
    purpose: "Land one judgment or metric with a clear support hierarchy.",
    slots: [
      { id: "title", required: true, kinds: ["text"], box: { x: 7, y: 10, w: 70, h: 15 }, style: { textRole: "title", colorToken: "ink" } },
      { id: "focal", required: true, kinds: ["text", "chart", "shape", "svg", "image"], box: { x: 7, y: 31, w: 57, h: 44 }, style: { textRole: "metric", colorToken: "primary", fillToken: "transparent" } },
      { id: "support", kinds: ["text", "table", "chart"], box: { x: 69, y: 34, w: 24, h: 38 }, style: { textRole: "body", colorToken: "muted" } },
      { id: "source", kinds: ["text"], box: { x: 7, y: 88, w: 70, h: 5 }, style: { textRole: "source", colorToken: "muted" } },
    ],
  },
  {
    id: "evidence-split",
    name: "Evidence split",
    pageRoles: ["evidence"],
    purpose: "Pair an answer-first claim with one legible evidence object.",
    slots: [
      { id: "title", required: true, kinds: ["text"], box: { x: 7, y: 7, w: 78, h: 14 }, style: { textRole: "title", colorToken: "ink" } },
      { id: "evidence", required: true, kinds: ["chart", "table", "image", "svg"], box: { x: 7, y: 27, w: 59, h: 56 }, style: { fillToken: "surface", strokeToken: "border", radiusRole: "small" } },
      { id: "support", kinds: ["text", "shape"], box: { x: 71, y: 29, w: 22, h: 48 }, style: { textRole: "body", colorToken: "ink" } },
      { id: "source", required: true, kinds: ["text"], box: { x: 7, y: 88, w: 86, h: 5 }, style: { textRole: "source", colorToken: "muted" } },
    ],
  },
  {
    id: "comparison-dual",
    name: "Comparison dual",
    pageRoles: ["comparison"],
    purpose: "Compare two alternatives on one shared visual baseline.",
    slots: [
      { id: "title", required: true, kinds: ["text"], box: { x: 7, y: 7, w: 80, h: 14 }, style: { textRole: "title", colorToken: "ink" } },
      { id: "left", required: true, kinds: ["text", "chart", "table", "shape", "image", "svg"], box: { x: 7, y: 28, w: 41, h: 54 }, style: { fillToken: "surface", strokeToken: "border", radiusRole: "small" } },
      { id: "right", required: true, kinds: ["text", "chart", "table", "shape", "image", "svg"], box: { x: 52, y: 28, w: 41, h: 54 }, style: { fillToken: "surface", strokeToken: "border", radiusRole: "small" } },
      { id: "source", required: true, kinds: ["text"], box: { x: 7, y: 88, w: 86, h: 5 }, style: { textRole: "source", colorToken: "muted" } },
    ],
  },
  {
    id: "process-flow",
    name: "Process flow",
    pageRoles: ["process"],
    purpose: "Explain a sequence with explicit direction and bounded steps.",
    slots: [
      { id: "title", required: true, kinds: ["text"], box: { x: 7, y: 7, w: 80, h: 14 }, style: { textRole: "title", colorToken: "ink" } },
      { id: "steps", required: true, repeatable: true, minItems: 2, maxItems: 6, layout: "row", kinds: ["shape"], box: { x: 7, y: 31, w: 86, h: 43 }, style: { textRole: "body", colorToken: "ink", fillToken: "surface", strokeToken: "border", radiusRole: "small" } },
      { id: "support", kinds: ["text"], box: { x: 7, y: 79, w: 70, h: 8 }, style: { textRole: "caption", colorToken: "muted" } },
      { id: "source", kinds: ["text"], box: { x: 7, y: 89, w: 86, h: 4 }, style: { textRole: "source", colorToken: "muted" } },
    ],
  },
  {
    id: "architecture-layers",
    name: "Architecture layers",
    pageRoles: ["architecture"],
    purpose: "Show system boundaries and dependencies as a constrained layer stack.",
    slots: [
      { id: "title", required: true, kinds: ["text"], box: { x: 7, y: 7, w: 80, h: 14 }, style: { textRole: "title", colorToken: "ink" } },
      { id: "layers", required: true, repeatable: true, minItems: 2, maxItems: 6, layout: "stack", kinds: ["shape"], box: { x: 11, y: 27, w: 66, h: 55 }, style: { textRole: "body", colorToken: "ink", fillToken: "surface", strokeToken: "border", radiusRole: "small" } },
      { id: "annotations", kinds: ["text"], box: { x: 81, y: 30, w: 12, h: 48 }, style: { textRole: "caption", colorToken: "muted" } },
      { id: "source", kinds: ["text"], box: { x: 7, y: 89, w: 86, h: 4 }, style: { textRole: "source", colorToken: "muted" } },
    ],
  },
  {
    id: "media-focus",
    name: "Media focus",
    pageRoles: ["media"],
    purpose: "Let grounded product or documentary media carry the page.",
    slots: [
      { id: "title", required: true, kinds: ["text"], box: { x: 7, y: 7, w: 80, h: 13 }, style: { textRole: "title", colorToken: "ink" } },
      { id: "media", required: true, kinds: ["image", "svg"], box: { x: 7, y: 24, w: 86, h: 59 }, style: { fillToken: "surface", strokeToken: "border", radiusRole: "small" } },
      { id: "caption", kinds: ["text"], box: { x: 7, y: 86, w: 60, h: 7 }, style: { textRole: "caption", colorToken: "muted" } },
      { id: "source", kinds: ["text"], box: { x: 69, y: 86, w: 24, h: 7 }, style: { textRole: "source", colorToken: "muted", align: "right" } },
    ],
  },
  {
    id: "closing-cta",
    name: "Closing action",
    pageRoles: ["closing"],
    purpose: "Conclude with one memorable decision and one concrete next action.",
    slots: [
      { id: "title", required: true, kinds: ["text"], box: { x: 17, y: 27, w: 66, h: 28 }, style: { textRole: "section", colorToken: "ink", align: "center", valign: "middle" } },
      { id: "action", required: true, kinds: ["text", "shape"], box: { x: 31, y: 62, w: 38, h: 12 }, style: { textRole: "body", colorToken: "primary", align: "center", valign: "middle" } },
      { id: "source", kinds: ["text"], box: { x: 25, y: 84, w: 50, h: 6 }, style: { textRole: "source", colorToken: "muted", align: "center" } },
    ],
  },
]);

const LEGACY_RECIPE = Object.freeze({
  id: "legacy-freeform",
  name: "Legacy freeform",
  pageRoles: [],
  purpose: "Compatibility-only rendering for decks authored before the recipe compiler.",
  legacy: true,
  slots: [],
});

function recipesForSystem(system) {
  const registeredRoles = new Set((system.archetypes || []).map((item) => item.id));
  const recipes = RECIPE_DEFINITIONS.filter((recipe) => recipe.pageRoles.some((role) => registeredRoles.has(role)));
  for (const archetype of system.archetypes || []) {
    if (recipes.some((recipe) => recipe.pageRoles.includes(archetype.id))) continue;
    recipes.push({
      id: `${archetype.id}-focus`,
      name: `${archetype.name} focus`,
      pageRoles: [archetype.id],
      purpose: archetype.purpose,
      slots: [
        { id: "title", required: true, kinds: ["text"], box: { x: 7, y: 7, w: 80, h: 15 }, style: { textRole: "title", colorToken: "ink" } },
        { id: "focal", required: true, kinds: ["text", "chart", "table", "shape", "image", "svg"], box: { x: 7, y: 29, w: 86, h: 52 }, style: { fillToken: "surface", strokeToken: "border", radiusRole: "small" } },
        { id: "source", kinds: ["text"], box: { x: 7, y: 88, w: 86, h: 5 }, style: { textRole: "source", colorToken: "muted" } },
      ],
    });
  }
  return recipes;
}

function createDesignPackage(system, contentHash = "") {
  const recipes = recipesForSystem(system);
  return {
    schemaVersion: DESIGN_PACKAGE_SCHEMA_VERSION,
    compilerVersion: SLIDE_COMPILER_VERSION,
    packageId: system.systemId,
    revision: Number(system.revision || 0),
    contentHash,
    foundation: {
      color: clone(system.color),
      typography: clone(system.typography),
      layout: clone(system.layout),
      shape: clone(system.shape),
      media: clone(system.media),
      chart: clone(system.chart),
      vector: clone(system.vector),
    },
    components: [
      { id: "text", contract: "Semantic type role and color token only" },
      { id: "panel", contract: "Surface, border, radius, and spacing tokens" },
      { id: "metric", contract: "Metric typography with one supporting label" },
      { id: "media-frame", contract: "Grounded asset, explicit alt text, and system media fit" },
      { id: "chart", contract: "Native data with registered series tokens" },
      { id: "table", contract: "Bounded rows with semantic header and body typography" },
      { id: "diagram", contract: "Token-bound shapes, connectors, and labels" },
      { id: "citation", contract: "Source typography on the safe-area baseline" },
    ],
    recipes: clone(recipes),
    compatibilityRecipes: [clone(LEGACY_RECIPE)],
  };
}

function recipeById(designPackage, recipeId) {
  return [...(designPackage.recipes || []), ...(designPackage.compatibilityRecipes || [])]
    .find((recipe) => recipe.id === recipeId) || null;
}

function defaultRecipeId(designPackage, pageRole) {
  return (designPackage.recipes || []).find((recipe) => recipe.pageRoles.includes(pageRole))?.id || null;
}

module.exports = {
  DESIGN_PACKAGE_SCHEMA_VERSION,
  LEGACY_RECIPE,
  RECIPE_DEFINITIONS,
  SLIDE_COMPILER_VERSION,
  createDesignPackage,
  defaultRecipeId,
  recipeById,
};
