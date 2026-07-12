const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const TOOLS_ROOT = path.join(SOURCE_ROOT, "tools");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    return entry.isDirectory() ? walk(filePath) : [filePath];
  });
}

test("advanced Excel Agent authoring contract", async (t) => {
  await t.test("all JSON parses and manifest references real tools and skills", () => {
    for (const filePath of walk(path.resolve(SOURCE_ROOT, "..")).filter((file) => file.endsWith(".json"))) {
      assert.doesNotThrow(() => readJson(filePath), filePath);
    }

    const manifest = readJson(path.join(SOURCE_ROOT, "manifest.json"));
    const prefix = `agentcomponent__${manifest.id}__`;
    const declaredTools = manifest.tools
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length))
      .sort();
    const toolDefinitions = fs.readdirSync(TOOLS_ROOT)
      .filter((name) => name.endsWith(".tool.json"))
      .map((name) => readJson(path.join(TOOLS_ROOT, name)).name)
      .sort();
    assert.deepEqual(declaredTools, toolDefinitions);
    for (const skill of manifest.skills) {
      assert.ok(fs.existsSync(path.join(SOURCE_ROOT, "skills", `${skill}.md`)), skill);
    }
  });

  await t.test("proposal schema exposes bounded content, style, formula, and layout composition", () => {
    const tool = readJson(path.join(TOOLS_ROOT, "propose_patch.tool.json"));
    const schema = tool.inputSchema;
    assert.deepEqual(schema.anyOf.map((branch) => branch.required[0]), [
      "cells",
      "values",
      "layout",
      "operations",
    ]);
    assert.equal(schema.properties.cells.maxItems, 5000);
    assert.deepEqual(schema.$defs.styleRole.enum, [
      "title",
      "header",
      "input",
      "output",
      "total",
      "note",
      "warning",
    ]);
    assert.ok(schema.$defs.style.properties.numberFormat);
    assert.ok(schema.$defs.style.properties.fill);
    assert.ok(schema.$defs.style.properties.font);
    assert.ok(schema.$defs.style.properties.border);
    assert.ok(schema.$defs.style.properties.alignment);
    assert.deepEqual(schema.$defs.style.type, ["object", "null"]);
    assert.deepEqual(schema.$defs.style.properties.fill.type, ["object", "null"]);
    assert.deepEqual(schema.$defs.style.properties.numberFormat.type, ["string", "null"]);
    assert.equal(schema.$defs.borderSide.properties.style.enum.includes("none"), false);
    assert.ok(schema.$defs.layout.properties.freezePanes);
    assert.ok(schema.$defs.layout.properties.autoFilter);
    assert.deepEqual(schema.properties.operations.items.properties.kind.enum, [
      "set_cells",
      "set_values",
      "set_formulas",
      "apply_style",
      "set_layout",
    ]);
  });

  await t.test("high-level operations compile into one deep-merged atomic proposal", () => {
    const { compileProposalInput } = require("../tools/propose_patch");
    const compiled = compileProposalInput({
      workbookId: "wb_1",
      expectedRevision: 7,
      intent: "Build a readable summary",
      sheetId: "sheet_1",
      operations: [
        { kind: "set_values", a1: "B2", values: [["Region", "Sales"], ["East", 1200]] },
        { kind: "set_formulas", a1: "D2", values: [["=SUM(C3:C3)"]] },
        {
          kind: "apply_style",
          a1: "B2:D2",
          styleRole: "header",
          style: { font: { bold: true, color: "FFFFFF" }, fill: { color: "1F4E78" } },
        },
        {
          kind: "apply_style",
          a1: "B2:D2",
          style: { font: { size: 12 }, alignment: { vertical: "center" } },
        },
        {
          kind: "set_layout",
          layout: {
            columns: [{ start: 1, end: 3, autoFit: true }],
            freezePanes: { rows: 1 },
          },
        },
        {
          kind: "set_layout",
          layout: {
            rows: [{ start: 1, height: 24 }],
            freezePanes: { columns: 1 },
            autoFilter: { a1: "B2:D3" },
          },
        },
      ],
    });

    assert.equal(compiled.operations, undefined);
    assert.equal(compiled.cells.length, 5);
    const b2 = compiled.cells.find((cell) => cell.row === 1 && cell.col === 1);
    assert.equal(b2.value, "Region");
    assert.equal(b2.styleRole, "header");
    assert.deepEqual(b2.style.font, { bold: true, color: "FFFFFF", size: 12 });
    assert.deepEqual(b2.style.fill, { color: "1F4E78" });
    assert.deepEqual(b2.style.alignment, { vertical: "center" });
    const d2 = compiled.cells.find((cell) => cell.row === 1 && cell.col === 3);
    assert.equal(d2.formula, "SUM(C3:C3)");
    assert.deepEqual(compiled.layout.freezePanes, { rows: 1, columns: 1 });
    assert.deepEqual(compiled.layout.columns, [{ start: 1, end: 3, autoFit: true }]);
    assert.deepEqual(compiled.layout.rows, [{ start: 1, height: 24 }]);
    assert.deepEqual(compiled.layout.autoFilter, { a1: "B2:D3" });
    assert.equal(compiled.resultCellLimit, 200);
  });

  await t.test("style-only compilation is valid and bounded to the engine limit", () => {
    const { compileProposalInput } = require("../tools/propose_patch");
    const compiled = compileProposalInput({
      workbookId: "wb_1",
      expectedRevision: 8,
      intent: "Clarify header hierarchy",
      operations: [{ kind: "apply_style", a1: "A1:C1", styleRole: "header" }],
    });
    assert.equal(compiled.cells.length, 3);
    assert.ok(compiled.cells.every((cell) => cell.value === undefined && cell.formula === undefined));
    assert.throws(
      () => compileProposalInput({ operations: [{ kind: "apply_style", a1: "A1:CZ100", styleRole: "header" }] }),
      /narrow the range below 5000/,
    );
    assert.equal(compileProposalInput({
      operations: [{ kind: "apply_style", a1: "'Summary View'!A1:C1", styleRole: "header" }],
    }).a1, "'Summary View'!A1");
    assert.throws(
      () => compileProposalInput({ operations: [
        { kind: "apply_style", a1: "Sheet1!A1", styleRole: "header" },
        { kind: "apply_style", a1: "Sheet2!A1", styleRole: "header" },
      ] }),
      /multiple sheets/,
    );
    assert.throws(
      () => compileProposalInput({
        sheetId: "sheet_1",
        operations: [{ kind: "apply_style", a1: "Sheet1!A1", styleRole: "header" }],
      }),
      /sheetId or a sheet-qualified/,
    );
    const cleared = compileProposalInput({
      operations: [
        { kind: "apply_style", a1: "A1", styleRole: "header", style: { font: { bold: true } } },
        { kind: "apply_style", a1: "A1", style: { font: { color: null }, fill: null } },
      ],
    }).cells[0];
    assert.equal(cleared.styleRole, "header");
    assert.deepEqual(cleared.style, { font: { bold: true, color: null }, fill: null });
    const fullyCleared = compileProposalInput({
      operations: [
        { kind: "apply_style", a1: "A1", styleRole: "header" },
        { kind: "apply_style", a1: "A1", style: null },
      ],
    }).cells[0];
    assert.equal(fullyCleared.style, null);
    assert.equal(fullyCleared.styleRole, undefined);
    const directClear = compileProposalInput({
      cells: [{ row: 0, col: 0, styleRole: "header", style: null }],
    }).cells[0];
    assert.equal(directClear.style, null);
    assert.equal(directClear.styleRole, undefined);
    const clearedLayout = compileProposalInput({
      layout: { columns: [{ start: 0, width: 12 }], rows: [{ start: 0, height: 20 }] },
      operations: [{
        kind: "set_layout",
        layout: { columns: [], rows: [], freezePanes: { rows: 0, columns: 0 }, autoFilter: null },
      }],
    }).layout;
    assert.deepEqual(clearedLayout, {
      columns: [],
      rows: [],
      freezePanes: { rows: 0, columns: 0 },
      autoFilter: null,
    });
  });

  await t.test("tool schemas require targets and bound range reads", () => {
    const switchSchema = readJson(path.join(TOOLS_ROOT, "switch_sheet.tool.json")).inputSchema;
    assert.deepEqual(switchSchema.anyOf, [
      { required: ["sheetId"] },
      { required: ["sheetName"] },
    ]);
    const readSchema = readJson(path.join(TOOLS_ROOT, "read_range.tool.json")).inputSchema;
    assert.equal(readSchema.properties.maxCells.maximum, 20000);
  });

  await t.test("proposal wrappers bound returned cell details", async () => {
    const proposalTool = require("../tools/propose_patch");
    const getProposalTool = require("../tools/get_proposal");
    assert.equal(proposalTool.compileProposalInput({ cells: [] }).resultCellLimit, 200);
    const result = await getProposalTool.run(
      { workbookId: "wb_1" },
      { workspaceRoot: "D:/trusted-workspace" },
    );
    assert.equal(result.bridgeCall.input.resultCellLimit, 200);
  });

  await t.test("lossy export acknowledgement is explicit and xlsx-only", () => {
    const { buildSaveInput } = require("../tools/save_workbook");
    assert.equal(buildSaveInput({ path: "exports/book.xlsx" }).acknowledgeFidelityLoss, false);
    assert.equal(buildSaveInput({
      path: "exports/book-lossy.xlsx",
      acknowledgeFidelityLoss: true,
    }).acknowledgeFidelityLoss, true);
    assert.throws(
      () => buildSaveInput({ path: "exports/book.xlsm", acknowledgeFidelityLoss: true }),
      /distinct \.xlsx/,
    );
  });

  await t.test("structure wrapper translates human indices and keeps one explicit action", () => {
    const { buildStructureCall } = require("../tools/edit_workbook_structure");
    assert.deepEqual(buildStructureCall({
      workbookId: "wb_1",
      expectedRevision: 9,
      intent: "Make room for assumptions",
      operation: "insert_rows",
      sheetId: "sheet_1",
      index: 3,
      count: 2,
    }).payload, {
      workbookId: "wb_1",
      expectedRevision: 9,
      intent: "Make room for assumptions",
      sheetId: "sheet_1",
      at: 2,
      count: 2,
    });
    assert.equal(buildStructureCall({
      workbookId: "wb_1",
      expectedRevision: 10,
      intent: "Add a review sheet",
      operation: "add_sheet",
      name: "Summary",
      columns: 12,
    }).action, "addSheet");
  });

  await t.test("system prompt preserves critical truth and quality boundaries", () => {
    const prompt = fs.readFileSync(path.join(SOURCE_ROOT, "agent.md"), "utf8");
    for (const statement of [
      "Point -> Transform -> Verify",
      "formulaStaticLint",
      "formulaRecalculation",
      "styleSourcePatch",
      "layoutSourcePatch",
      "REVISION_CONFLICT",
      "Success requires bridge status `completed`",
      "Never call Bash, Memory, Write, Edit, ComputerUse",
      "xlsm",
      "acknowledgeFidelityLoss",
      "columns: []",
    ]) {
      assert.ok(prompt.includes(statement), statement);
    }
    assert.equal(prompt.includes("\u922b"), false);
  });
});
