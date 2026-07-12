const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const engine = require("../src/engine");
const io = require("../src/xlsx-io");
const store = require("../src/workbook-store");

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "excel-advanced-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function hash(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

test("advanced Excel creation contract", async (t) => {
  await t.test("reviews, applies, reads, undoes, and redoes style and layout proposals", (t) => {
    const root = workspace(t);
    const created = engine.dispatch("createWorkbook", { workspacePath: root, title: "Styled" });
    const workbookId = created.meta.workbookId;
    const sheetId = created.meta.activeSheetId;

    const proposal = engine.dispatch("proposePatch", {
      workspacePath: root,
      workbookId,
      expectedRevision: 0,
      sheetId,
      intent: "Create a readable financial table",
      cells: [
        { row: 0, col: 0, value: "Revenue", styleRole: "header" },
        { row: 1, col: 0, value: 1200, style: { numberFormat: "#,##0.00" } },
        { row: 1, col: 1, value: 300 },
        { row: 1, col: 2, formula: "SUM(A2:B2)", styleRole: "output" },
      ],
      layout: {
        columns: [{ start: 0, end: 2, width: 14 }],
        rows: [{ start: 0, height: 24 }],
        freezePanes: { rows: 1, columns: 0 },
        autoFilter: { a1: "A1:C2" },
      },
      resultCellLimit: 2,
    });

    assert.equal(proposal.proposal.layout.after.units.columnWidth, "excelCharacters");
    assert.equal(proposal.proposal.validation.formulaLint.recalculated, false);
    assert.match(proposal.proposal.validation.formulaLint.note, /not calculated/i);
    assert.equal(proposal.cells[0].after.style.role, "header");
    assert.equal(proposal.cells.length, 2);
    assert.equal(proposal.totalCellCount, 4);
    assert.equal(proposal.cellDetailsTruncated, true);
    const fullProposal = engine.dispatch("getProposal", { workspacePath: root, workbookId });
    assert.equal(fullProposal.proposal.cells.length, 4, "direct callers receive full proposal details by default");
    assert.equal(fullProposal.cellDetailsTruncated, false);
    assert.equal(created.meta.revision, 0, "a proposal must not mutate committed workbook content");

    const accepted = engine.dispatch("acceptProposal", {
      workspacePath: root,
      workbookId,
      expectedRevision: 0,
      proposalId: proposal.proposal.id,
    });
    assert.equal(accepted.meta.revision, 1);
    assert.equal(accepted.applied.layoutApplied, true);

    let read = engine.dispatch("readRange", {
      workspacePath: root,
      workbookId,
      a1: "A1:C2",
    });
    assert.equal(read.cells.find((cell) => cell.a1 === "A1").style.fill.color, "#1F4E78");
    assert.equal(read.cells.find((cell) => cell.a1 === "A2").style.numberFormat, "#,##0.00");
    assert.equal(read.cells.find((cell) => cell.a1 === "C2").formula, "SUM(A2:B2)");
    assert.deepEqual(read.layout.freezePanes, { rows: 1, columns: 0 });

    engine.dispatch("undo", { workspacePath: root, workbookId, expectedRevision: 1 });
    read = engine.dispatch("readRange", { workspacePath: root, workbookId, a1: "A1:C2" });
    assert.equal(read.cells.length, 0);
    assert.deepEqual(read.layout.freezePanes, { rows: 0, columns: 0 });

    engine.dispatch("redo", { workspacePath: root, workbookId, expectedRevision: 2 });
    read = engine.dispatch("readRange", { workspacePath: root, workbookId, a1: "A1:C2" });
    assert.equal(read.cells.find((cell) => cell.a1 === "A1").style.role, "header");
    assert.deepEqual(read.layout.autoFilter, { a1: "A1:C2" });
  });

  await t.test("merges partial styles and splits overlapping layout bands without data loss", (t) => {
    const root = workspace(t);
    const created = engine.dispatch("createWorkbook", { workspacePath: root });
    const workbookId = created.meta.workbookId;
    const sheetId = created.meta.activeSheetId;

    engine.dispatch("applyLocalEdit", {
      workspacePath: root,
      workbookId,
      expectedRevision: 0,
      sheetId,
      row: 0,
      col: 0,
      value: "Header",
      styleRole: "header",
    });
    engine.dispatch("applyLocalEdit", {
      workspacePath: root,
      workbookId,
      expectedRevision: 1,
      sheetId,
      row: 0,
      col: 0,
      style: { font: { italic: true }, numberFormat: "@" },
    });
    let read = engine.dispatch("readRange", { workspacePath: root, workbookId, a1: "A1" });
    assert.equal(read.cells[0].style.font.bold, true);
    assert.equal(read.cells[0].style.font.italic, true);
    assert.equal(read.cells[0].style.fill.color, "#1F4E78");
    engine.dispatch("applyLocalEdit", {
      workspacePath: root,
      workbookId,
      expectedRevision: 2,
      sheetId,
      row: 0,
      col: 0,
      styleRole: "input",
    });
    read = engine.dispatch("readRange", { workspacePath: root, workbookId, a1: "A1" });
    assert.equal(read.cells[0].style.role, "input");
    assert.equal(read.cells[0].style.fill.color, "#FFF2CC");
    assert.equal(read.cells[0].style.font, undefined, "switching roles must not retain header font styling");
    assert.equal(read.cells[0].style.numberFormat, "@", "role changes preserve independent number formats");

    engine.dispatch("applyLayout", {
      workspacePath: root,
      workbookId,
      expectedRevision: 3,
      sheetId,
      layout: { columns: [{ start: 0, end: 5, width: 10 }] },
    });
    const changed = engine.dispatch("applyLayout", {
      workspacePath: root,
      workbookId,
      expectedRevision: 4,
      sheetId,
      layout: { columns: [{ start: 2, end: 3, width: 20 }] },
    });
    assert.deepEqual(changed.layout.columns, [
      { start: 0, end: 1, width: 10 },
      { start: 2, end: 3, width: 20 },
      { start: 4, end: 5, width: 10 },
    ]);
    const autoFit = engine.dispatch("applyLayout", {
      workspacePath: root,
      workbookId,
      expectedRevision: 5,
      sheetId,
      layout: { columns: [{ start: 6, autoFit: true }] },
    });
    assert.deepEqual(autoFit.layout.columns.at(-1), {
      start: 6,
      end: 6,
      width: 18,
      autoFit: true,
    });
    assert.throws(
      () => engine.dispatch("insertColumns", {
        workspacePath: root,
        workbookId,
        expectedRevision: 6,
        sheetId,
        at: 0,
        count: 1,
      }),
      /LAYOUT_REFERENCE_RISK/
    );
  });

  await t.test("rejects conflicting sheet targets and Excel-invalid sheet names", (t) => {
    const root = workspace(t);
    const created = engine.dispatch("createWorkbook", { workspacePath: root, sheetName: "Data" });
    const workbookId = created.meta.workbookId;
    const dataSheetId = created.meta.activeSheetId;
    const added = engine.dispatch("addSheet", {
      workspacePath: root,
      workbookId,
      expectedRevision: 0,
      name: "Summary",
    });
    assert.throws(
      () => engine.dispatch("proposePatch", {
        workspacePath: root,
        workbookId,
        expectedRevision: 1,
        sheetId: dataSheetId,
        a1: "Summary!A1",
        values: [[1]],
      }),
      /SHEET_QUALIFIER_CONFLICT/
    );
    assert.throws(
      () => engine.dispatch("renameSheet", {
        workspacePath: root,
        workbookId,
        expectedRevision: 1,
        sheetId: added.sheet.id,
        name: "Invalid/Name",
      }),
      /INVALID_SHEET_NAME/
    );
    assert.throws(
      () => engine.dispatch("addSheet", {
        workspacePath: root,
        workbookId,
        expectedRevision: 1,
        name: "x".repeat(32),
      }),
      /INVALID_SHEET_NAME/
    );
  });

  await t.test("blocks invalid formulas and reports external links as static warnings", (t) => {
    const root = workspace(t);
    const created = engine.dispatch("createWorkbook", { workspacePath: root });
    const workbookId = created.meta.workbookId;
    const sheetId = created.meta.activeSheetId;

    assert.throws(
      () => engine.dispatch("proposePatch", {
        workspacePath: root,
        workbookId,
        expectedRevision: 0,
        sheetId,
        cells: [{ row: 0, col: 0, formula: "A1+1" }],
      }),
      /FORMULA_SELF_REFERENCE/
    );
    assert.throws(
      () => engine.dispatch("proposePatch", {
        workspacePath: root,
        workbookId,
        expectedRevision: 0,
        sheetId,
        cells: [{ row: 0, col: 1, formula: "SUM(A1:B1" }],
      }),
      /FORMULA_PAREN_UNBALANCED/
    );
    const warned = engine.dispatch("proposePatch", {
      workspacePath: root,
      workbookId,
      expectedRevision: 0,
      sheetId,
      cells: [{ row: 0, col: 2, formula: "'[Budget.xlsx]Sheet1'!A1" }],
    });
    assert.equal(warned.proposal.validation.formulaLint.recalculated, false);
    assert.ok(warned.proposal.validation.formulaLint.warnings.some((issue) => issue.code === "FORMULA_EXTERNAL_LINK"));
  });

  await t.test("writes and reopens styled XLSX with valid layout XML", (t) => {
    const root = workspace(t);
    const workbook = store.createEmpty({ title: "Export" });
    const sheet = workbook.sheets[0];
    sheet.cells["0,0"] = {
      v: "Total",
      t: "s",
      style: {
        role: "total",
        fill: { color: "#DDEBF7" },
        font: { bold: true, color: "#17365D", size: 12 },
        border: { top: { style: "double", color: "#1F1F1F" } },
        alignment: { horizontal: "right", wrapText: true },
        numberFormat: "#,##0.00",
      },
    };
    sheet.layout = {
      units: { columnWidth: "excelCharacters", rowHeight: "points" },
      columns: [{ start: 0, end: 1, width: 16, autoFit: true }],
      rows: [{ start: 0, end: 0, height: 27 }],
      freezePanes: { rows: 1, columns: 0 },
      autoFilter: { a1: "A1:B5" },
    };
    const output = path.join(root, "styled.xlsx");
    fs.writeFileSync(output, io.writeXlsxBuffer(workbook));

    const files = io.unzipBuffer(fs.readFileSync(output));
    assert.ok(files.has("xl/styles.xml"));
    assert.match(files.get("xl/styles.xml").toString("utf8"), /formatCode="#,##0\.00"/);
    const sheetXml = files.get("xl/worksheets/sheet1.xml").toString("utf8");
    assert.match(sheetXml, /activePane="bottomLeft"/);
    assert.match(sheetXml, /<col min="1" max="2" width="16" bestFit="1"/);
    assert.match(sheetXml, /<autoFilter ref="A1:B5"\/>/);
    sheet.layout.freezePanes = { rows: 0, columns: 1 };
    let paneXml = io.unzipBuffer(io.writeXlsxBuffer(workbook))
      .get("xl/worksheets/sheet1.xml").toString("utf8");
    assert.match(paneXml, /activePane="topRight"/);
    sheet.layout.freezePanes = { rows: 1, columns: 1 };
    paneXml = io.unzipBuffer(io.writeXlsxBuffer(workbook))
      .get("xl/worksheets/sheet1.xml").toString("utf8");
    assert.match(paneXml, /activePane="bottomRight"/);
    sheet.layout.freezePanes = { rows: 1, columns: 0 };

    const reopened = io.readWorkbookFile(output);
    assert.equal(reopened.sheets[0].cells["0,0"].style.fill.color, "#DDEBF7");
    assert.equal(reopened.sheets[0].cells["0,0"].style.numberFormat, "#,##0.00");
    assert.equal(reopened.sheets[0].cells["0,0"].style.border.top.style, "double");
    assert.equal(reopened.sheets[0].cells["0,0"].style.alignment.horizontal, "right");
    assert.equal(reopened.sheets[0].cells["0,0"].style.alignment.wrapText, true);
    assert.equal(reopened.sheets[0].layout.columns[0].width, 16);
    assert.equal(reopened.sheets[0].layout.rows[0].height, 27);
    assert.deepEqual(reopened.sheets[0].layout.freezePanes, { rows: 1, columns: 0 });
  });

  await t.test("never silently drops style changes when exporting an imported Excel source", (t) => {
    const root = workspace(t);
    const source = path.join(root, "source.xlsx");
    const sourceWorkbook = store.createEmpty({ title: "Source" });
    sourceWorkbook.sheets[0].cells["0,0"] = { v: 1, t: "n", style: { numberFormat: "0.00" } };
    fs.writeFileSync(source, io.writeXlsxBuffer(sourceWorkbook));
    const sourceHash = hash(source);

    const opened = engine.dispatch("openWorkbook", { workspacePath: root, path: source });
    const workbookId = opened.meta.workbookId;
    const sheetId = opened.meta.activeSheetId;
    const proposal = engine.dispatch("proposePatch", {
      workspacePath: root,
      workbookId,
      expectedRevision: 0,
      sheetId,
      cells: [{ row: 0, col: 0, style: { fill: { color: "#FFF2CC" } } }],
    });
    const accepted = engine.dispatch("acceptProposal", {
      workspacePath: root,
      workbookId,
      expectedRevision: 0,
      proposalId: proposal.proposal.id,
    });
    assert.equal(accepted.meta.fidelity.canRoundTrip, false);
    assert.match(accepted.meta.fidelity.warning, /style/i);
    const undone = engine.dispatch("undo", {
      workspacePath: root,
      workbookId,
      expectedRevision: 1,
    });
    assert.equal(undone.meta.fidelity.canRoundTrip, true);
    const redone = engine.dispatch("redo", {
      workspacePath: root,
      workbookId,
      expectedRevision: 2,
    });
    assert.equal(redone.meta.fidelity.canRoundTrip, false);

    const copy = path.join(root, "styled-copy.xlsx");
    assert.throws(
      () => engine.dispatch("saveWorkbook", {
        workspacePath: root,
        workbookId,
        expectedRevision: 3,
        path: copy,
      }),
      /FIDELITY_ACK_REQUIRED/
    );
    const saved = engine.dispatch("saveWorkbook", {
      workspacePath: root,
      workbookId,
      expectedRevision: 3,
      path: copy,
      acknowledgeFidelityLoss: true,
    });
    assert.equal(saved.export.mode, "lossy-rebuild");
    assert.equal(saved.export.fullCalcOnLoad, true);
    assert.equal(hash(source), sourceHash);
    assert.equal(io.readWorkbookFile(copy).sheets[0].cells["0,0"].style.fill.color, "#FFF2CC");
  });
});
