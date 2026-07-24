const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const sourceRoot = path.resolve(__dirname, "..");
const toolsRoot = path.join(sourceRoot, "tools");

for (const filename of fs.readdirSync(toolsRoot).filter((name) => name.endsWith(".tool.json"))) {
  test(`${filename} exports the Agent Component run ABI`, async () => {
    const definition = JSON.parse(fs.readFileSync(path.join(toolsRoot, filename), "utf8"));
    const entry = path.resolve(sourceRoot, definition.entry);
    const moduleValue = require(entry);
    assert.equal(typeof moduleValue, "object");
    assert.equal(typeof moduleValue.run, "function");
    const result = await moduleValue.run({});
    assert.equal(result.bridgeCall.bridgeId, "builtin-ppt-runtime");
    assert.equal(typeof result.bridgeCall.action, "string");
  });
}

test("manuscript commit exposes the structured runtime contract and canonical bridge action", async () => {
  const definition = JSON.parse(fs.readFileSync(path.join(toolsRoot, "commit_presentation_manuscript.tool.json"), "utf8"));
  const properties = definition.inputSchema.properties;
  assert.equal(properties.manuscript.type, "object");
  assert.equal(properties.speakerScript.type, "object");
  assert.equal(properties.manuscript.properties.slides.items.properties.slideId.pattern, "^p[0-9]{2,3}$");
  assert.deepEqual(
    properties.manuscript.properties.slides.items.properties.visualDirection.required,
    ["pageRole", "recipe", "visualMode", "evidenceObject", "exportStrategy", "artDirection"],
  );
  const moduleValue = require(path.resolve(sourceRoot, definition.entry));
  const result = await moduleValue.run({});
  assert.equal(result.bridgeCall.action, "commitPresentationDocument");
});

test("agent does not advertise the optional presentation skill as a required tool", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.skills, []);
  assert.equal(manifest.tools.includes("Skill"), false);
});

test("visual tools bind to Manuscript revisions without exposing Blueprint fields", () => {
  for (const filename of [
    "render_design_case.tool.json",
    "generate_slide_visual.tool.json",
    "prepare_visual_assets.tool.json",
    "review_deck.tool.json",
  ]) {
    const definition = JSON.parse(fs.readFileSync(path.join(toolsRoot, filename), "utf8"));
    const properties = definition.inputSchema.properties;
    assert.equal("expectedBlueprintRevision" in properties, false, filename);
    assert.equal(properties.expectedManuscriptRevision.type, "integer", filename);
  }
  const prompt = fs.readFileSync(path.join(sourceRoot, "agent.md"), "utf8");
  assert.equal(prompt.includes("ContentBlueprint"), false);
  assert.match(prompt, /Runtime must not inject or require string equality/);
  const review = JSON.parse(fs.readFileSync(path.join(toolsRoot, "review_deck.tool.json"), "utf8"));
  assert.equal(review.inputSchema.properties.alignmentCoverage.properties.checks.minItems, 6);
});
