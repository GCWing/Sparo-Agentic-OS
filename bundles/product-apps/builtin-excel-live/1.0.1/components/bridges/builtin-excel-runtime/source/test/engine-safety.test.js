const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const engine = require("../src/engine");
const store = require("../src/workbook-store");
const io = require("../src/xlsx-io");
const csv = require("../src/csv-io");

function tempWorkspace(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    const resolved = path.resolve(root);
    const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.ok(resolved.startsWith(tempRoot), `Refusing unsafe cleanup: ${resolved}`);
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeInstrumentedExcelSource(root, options = {}) {
  const extension = options.extension || ".xlsx";
  const filePath = path.join(root, `source${extension}`);
  const workbook = store.createEmpty({ title: "Source" });
  workbook.sheets[0].cells["0,0"] = { v: 1, t: "n" };
  if (options.withFormula !== false) {
    workbook.sheets[0].cells["0,1"] = { f: "A1*2", v: 2, t: "f" };
  }
  const files = io.unzipBuffer(io.writeXlsxBuffer(workbook));
  const sheetPath = "xl/worksheets/sheet1.xml";
  files.set(
    sheetPath,
    Buffer.from(
      files.get(sheetPath).toString("utf8").replace('<c r="A1"', '<c r="A1" s="0"'),
      "utf8"
    )
  );
  files.set(
    "xl/styles.xml",
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      "utf8"
    )
  );
  files.set("custom/opaque.bin", Buffer.from([0, 1, 2, 253, 254, 255]));
  files.set(
    "xl/calcChain.xml",
    Buffer.from(
      '<?xml version="1.0"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B1" i="1"/></calcChain>',
      "utf8"
    )
  );
  files.set(
    "xl/_rels/workbook.xml.rels",
    Buffer.from(
      files
        .get("xl/_rels/workbook.xml.rels")
        .toString("utf8")
        .replace(
          "</Relationships>",
          '<Relationship Id="rIdStyle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdCalc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>'
        ),
      "utf8"
    )
  );
  files.set(
    "[Content_Types].xml",
    Buffer.from(
      files
        .get("[Content_Types].xml")
        .toString("utf8")
        .replace(
          "</Types>",
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/></Types>'
        ),
      "utf8"
    )
  );

  if (extension === ".xlsm") {
    const macroBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0, 1, 2, 3]);
    files.set("xl/vbaProject.bin", macroBytes);
    files.set(
      "[Content_Types].xml",
      Buffer.from(
        files
          .get("[Content_Types].xml")
          .toString("utf8")
          .replace(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
            "application/vnd.ms-excel.sheet.macroEnabled.main+xml"
          )
          .replace(
            "</Types>",
            '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>'
          ),
        "utf8"
      )
    );
    files.set(
      "xl/_rels/workbook.xml.rels",
      Buffer.from(
        files
          .get("xl/_rels/workbook.xml.rels")
          .toString("utf8")
          .replace(
            "</Relationships>",
            '<Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>'
          ),
        "utf8"
      )
    );
  }

  fs.writeFileSync(
    filePath,
    io.zipStore([...files].map(([name, data]) => ({ name, data })))
  );
  return filePath;
}

function writeWorkbookWithCellRef(root, fileName, cellRef) {
  const workbook = store.createEmpty({ title: "Cell reference" });
  workbook.sheets[0].cells["0,0"] = { v: 1, t: "n" };
  const files = io.unzipBuffer(io.writeXlsxBuffer(workbook));
  const sheetPath = "xl/worksheets/sheet1.xml";
  files.set(
    sheetPath,
    Buffer.from(
      files.get(sheetPath).toString("utf8").replace('<c r="A1"', `<c r="${cellRef}"`),
      "utf8"
    )
  );
  const filePath = path.join(root, fileName);
  fs.writeFileSync(filePath, io.zipStore([...files].map(([name, data]) => ({ name, data }))));
  return filePath;
}

function writeWorkbookWithSerializedCellCount(root, fileName, cellCount) {
  const workbook = store.createEmpty({ title: "Cell budget" });
  const files = io.unzipBuffer(io.writeXlsxBuffer(workbook));
  const sheetPath = "xl/worksheets/sheet1.xml";
  const xml = files.get(sheetPath).toString("utf8").replace(
    /<sheetData>[\s\S]*?<\/sheetData>/,
    `<sheetData><row r="1">${'<c r="A1"><v>1</v></c>'.repeat(cellCount)}</row></sheetData>`
  );
  files.set(sheetPath, Buffer.from(xml, "utf8"));
  const filePath = path.join(root, fileName);
  fs.writeFileSync(filePath, io.zipStore([...files].map(([name, data]) => ({ name, data }))));
  return filePath;
}

function writeSparseFile(filePath, size) {
  fs.writeFileSync(filePath, "");
  fs.truncateSync(filePath, size);
}

test("Excel Live engine safety contract", async (t) => {
  await t.test("enforces Inspect mode, monotonic revision, undo, redo, and formula structure safety", (t) => {
    const root = tempWorkspace(t, "excel-engine-revision-");
    const created = engine.dispatch("createWorkbook", { workspacePath: root, title: "Revision" });
    const workbookId = created.meta.workbookId;
    const sheetId = created.meta.activeSheetId;

    engine.dispatch("setFocus", {
      workspacePath: root,
      workbookId,
      sheetId,
      a1: "B2",
      mode: "inspect",
    });
    let meta = engine.dispatch("getMeta", { workspacePath: root, workbookId }).meta;
    assert.equal(meta.revision, 0);
    assert.equal(meta.dirty, false);
    assert.equal(meta.mode, "inspect");
    assert.throws(
      () => engine.dispatch("applyLocalEdit", {
        workspacePath: root,
        workbookId,
        sheetId,
        row: 0,
        col: 0,
        value: 1,
      }),
      /INSPECT_MODE_READ_ONLY/
    );
    assert.throws(
      () => engine.dispatch("proposePatch", {
        workspacePath: root,
        workbookId,
        sheetId,
        cells: [{ row: 0, col: 0, value: 1 }],
      }),
      /INSPECT_MODE_READ_ONLY/
    );

    engine.dispatch("setMode", { workspacePath: root, workbookId, mode: "edit" });
    const applied = engine.dispatch("applyLocalPatch", {
      workspacePath: root,
      workbookId,
      sheetId,
      a1: "A1",
      values: [[1, 2], [3, 4]],
      baseRevision: 0,
    });
    assert.equal(applied.meta.revision, 1);
    assert.throws(
      () => engine.dispatch("applyLocalEdit", {
        workspacePath: root,
        workbookId,
        sheetId,
        row: 0,
        col: 0,
        value: 8,
        expectedRevision: 0,
      }),
      /REVISION_CONFLICT/
    );

    const undone = engine.dispatch("undo", {
      workspacePath: root,
      workbookId,
      expectedRevision: 1,
    });
    assert.equal(undone.meta.revision, 2);
    assert.deepEqual(
      engine.dispatch("readRange", {
        workspacePath: root,
        workbookId,
        sheetId,
        a1: "A1:B2",
      }).values,
      [[null, null], [null, null]]
    );

    const redone = engine.dispatch("redo", {
      workspacePath: root,
      workbookId,
      expectedRevision: 2,
    });
    assert.equal(redone.meta.revision, 3);
    assert.deepEqual(
      engine.dispatch("readRange", {
        workspacePath: root,
        workbookId,
        sheetId,
        a1: "A1:B2",
      }).values,
      [[1, 2], [3, 4]]
    );
    const history = engine.dispatch("getHistory", { workspacePath: root, workbookId });
    assert.equal(history.entries.length, 3);
    assert.equal(history.canUndo, true);
    assert.equal(history.canRedo, false);

    engine.dispatch("applyLocalEdit", {
      workspacePath: root,
      workbookId,
      sheetId,
      row: 2,
      col: 0,
      formula: "=A1+B1",
      expectedRevision: 3,
    });
    assert.throws(
      () => engine.dispatch("insertRows", {
        workspacePath: root,
        workbookId,
        sheetId,
        at: 0,
        expectedRevision: 4,
      }),
      /FORMULA_REFERENCE_RISK/
    );
  });

  await t.test("keeps proposals uncommitted, rejects replacement, and safely partially accepts", (t) => {
    const root = tempWorkspace(t, "excel-engine-proposal-");
    const created = engine.dispatch("createWorkbook", { workspacePath: root });
    const workbookId = created.meta.workbookId;
    const sheetId = created.meta.activeSheetId;
    engine.dispatch("applyLocalPatch", {
      workspacePath: root,
      workbookId,
      sheetId,
      a1: "A1",
      values: [[1, 2]],
      expectedRevision: 0,
    });

    const proposal = engine.dispatch("proposePatch", {
      workspacePath: root,
      workbookId,
      sheetId,
      cells: [
        { row: 0, col: 0, value: 10 },
        { row: 0, col: 1, value: 20 },
      ],
      expectedRevision: 1,
      intent: "Raise values",
    });
    assert.equal(proposal.proposal.baseRevision, 1);
    assert.equal(proposal.proposal.intent, "Raise values");
    assert.deepEqual(
      engine.dispatch("readRange", {
        workspacePath: root,
        workbookId,
        sheetId,
        a1: "A1:B1",
      }).values,
      [[1, 2]],
      "proposePatch must not mutate committed cells"
    );
    assert.throws(
      () => engine.dispatch("proposePatch", {
        workspacePath: root,
        workbookId,
        sheetId,
        cells: [{ row: 1, col: 0, value: 30 }],
        expectedRevision: 1,
      }),
      /ACTIVE_PROPOSAL_EXISTS/
    );

    const partial = engine.dispatch("acceptProposal", {
      workspacePath: root,
      workbookId,
      proposalId: proposal.proposal.id,
      cellRefs: [`${sheetId}!A1`],
      baseRevision: 1,
    });
    assert.equal(partial.applied.cellCount, 1);
    assert.equal(partial.meta.revision, 2);
    assert.equal(partial.remainingProposal.cellCount, 1);
    assert.equal(partial.remainingProposal.baseRevision, 2);
    assert.deepEqual(
      engine.dispatch("readRange", {
        workspacePath: root,
        workbookId,
        sheetId,
        a1: "A1:B1",
      }).values,
      [[10, 2]]
    );

    const complete = engine.dispatch("acceptProposal", {
      workspacePath: root,
      workbookId,
      proposalId: proposal.proposal.id,
      cellRefs: ["B1"],
      expectedRevision: 2,
    });
    assert.equal(complete.meta.revision, 3);
    assert.equal(complete.remainingProposal, null);

    const conflicting = engine.dispatch("proposePatch", {
      workspacePath: root,
      workbookId,
      sheetId,
      cells: [{ row: 1, col: 0, value: 99 }],
      expectedRevision: 3,
    });
    engine.sessions.get(workbookId).workbook.sheets[0].cells["1,0"] = { v: 7, t: "n" };
    assert.throws(
      () => engine.dispatch("acceptProposal", {
        workspacePath: root,
        workbookId,
        proposalId: conflicting.proposal.id,
        expectedRevision: 3,
      }),
      /PROPOSAL_BEFORE_CONFLICT/
    );
    assert.equal(engine.sessions.get(workbookId).workbook.revision, 3);
  });

  await t.test("exports a source-preserving copy without changing source hash or workbook identity", (t) => {
    const root = tempWorkspace(t, "excel-engine-safe-copy-");
    const sourcePath = writeInstrumentedExcelSource(root);
    const copyPath = path.join(root, "copy.xlsx");
    const sourceHash = sha256(sourcePath);
    const opened = engine.dispatch("openWorkbook", { workspacePath: root, path: sourcePath });
    const workbookId = opened.meta.workbookId;
    const sheetId = opened.meta.activeSheetId;

    engine.dispatch("applyLocalEdit", {
      workspacePath: root,
      workbookId,
      sheetId,
      row: 0,
      col: 0,
      value: 3,
      expectedRevision: 0,
    });
    engine.dispatch("applyLocalEdit", {
      workspacePath: root,
      workbookId,
      sheetId,
      row: 0,
      col: 1,
      formula: "=A1*4",
      expectedRevision: 1,
    });
    assert.throws(
      () => engine.dispatch("saveWorkbook", {
        workspacePath: root,
        workbookId,
        expectedRevision: 2,
      }),
      /SOURCE_OVERWRITE_BLOCKED/
    );
    assert.throws(
      () => engine.dispatch("saveWorkbook", {
        workspacePath: root,
        workbookId,
        path: copyPath,
        exportCopy: true,
        expectedRevision: 1,
      }),
      /REVISION_CONFLICT/
    );

    const saved = engine.dispatch("saveWorkbook", {
      workspacePath: root,
      workbookId,
      path: copyPath,
      exportCopy: true,
      expectedRevision: 2,
    });
    assert.equal(saved.export.mode, "source-preserving-cell-patch");
    assert.equal(saved.workingPath, sourcePath);
    assert.equal(saved.meta.path, sourcePath);
    assert.equal(saved.meta.sourcePath, sourcePath);
    assert.equal(saved.meta.lastExportPath, copyPath);
    assert.equal(saved.meta.lastExportedRevision, 2);
    assert.equal(saved.meta.dirty, false);
    assert.equal(sha256(sourcePath), sourceHash, "export copy must not mutate the imported source");

    const output = io.unzipBuffer(fs.readFileSync(copyPath));
    assert.deepEqual(output.get("custom/opaque.bin"), Buffer.from([0, 1, 2, 253, 254, 255]));
    const sheetXml = output.get("xl/worksheets/sheet1.xml").toString("utf8");
    assert.match(sheetXml, /<c r="A1" s="0"><v>3<\/v><\/c>/);
    assert.deepEqual(output.get("xl/styles.xml"), io.unzipBuffer(fs.readFileSync(sourcePath)).get("xl/styles.xml"));
    assert.match(sheetXml, /<c r="B1"><f>A1\*4<\/f><\/c>/);
    assert.equal(output.has("xl/calcChain.xml"), false);
    assert.doesNotMatch(
      output.get("xl/_rels/workbook.xml.rels").toString("utf8"),
      /calcChain/i
    );
    assert.match(
      output.get("xl/workbook.xml").toString("utf8"),
      /fullCalcOnLoad="1"[^>]*forceFullCalc="1"/
    );
    assert.equal(io.readWorkbookFile(copyPath).sheets[0].cells["0,1"].f, "A1*4");

    engine.sessions.clear();
    const resumed = engine.dispatch("getMeta", { workspacePath: root, workbookId }).meta;
    assert.equal(resumed.path, sourcePath);
    assert.equal(resumed.sourcePath, sourcePath);
    assert.equal(resumed.lastExportPath, copyPath);
  });

  await t.test("preserves unknown row XML while patching a source cell", (t) => {
    const root = tempWorkspace(t, "excel-engine-row-xml-");
    const sourcePath = writeInstrumentedExcelSource(root, { withFormula: false });
    const copyPath = path.join(root, "row-xml-copy.xlsx");
    const files = io.unzipBuffer(fs.readFileSync(sourcePath));
    const sheetPath = "xl/worksheets/sheet1.xml";
    const marker = '<extLst><ext uri="{SPARO-ROW-METADATA}"/></extLst>';
    files.set(
      sheetPath,
      Buffer.from(
        files.get(sheetPath).toString("utf8").replace("</row>", `${marker}</row>`),
        "utf8"
      )
    );
    fs.writeFileSync(
      sourcePath,
      io.zipStore([...files].map(([name, data]) => ({ name, data })))
    );

    const opened = engine.dispatch("openWorkbook", { workspacePath: root, path: sourcePath });
    engine.dispatch("applyLocalEdit", {
      workspacePath: root,
      workbookId: opened.meta.workbookId,
      sheetId: opened.meta.activeSheetId,
      row: 0,
      col: 0,
      value: 7,
      expectedRevision: 0,
    });
    const saved = engine.dispatch("saveWorkbook", {
      workspacePath: root,
      workbookId: opened.meta.workbookId,
      path: copyPath,
      exportCopy: true,
      expectedRevision: 1,
    });
    assert.equal(saved.export.mode, "source-preserving-cell-patch");
    const outputXml = io
      .unzipBuffer(fs.readFileSync(copyPath))
      .get(sheetPath)
      .toString("utf8");
    assert.match(outputXml, /SPARO-ROW-METADATA/);
    assert.match(outputXml, /<c r="A1" s="0"><v>7<\/v><\/c>/);
  });

  await t.test("recognizes shared formula followers and blocks edits inside complex formula ranges", (t) => {
    const root = tempWorkspace(t, "excel-engine-complex-formula-");
    const sourcePath = writeInstrumentedExcelSource(root, { withFormula: false });
    const copyPath = path.join(root, "complex-formula-copy.xlsx");
    const files = io.unzipBuffer(fs.readFileSync(sourcePath));
    const sheetPath = "xl/worksheets/sheet1.xml";
    const sourceXml = files.get(sheetPath).toString("utf8");
    files.set(
      sheetPath,
      Buffer.from(
        sourceXml.replace(
          /<sheetData>[\s\S]*?<\/sheetData>/,
          '<sheetData><row r="1"><c r="A1"><f t="shared" ref="A1:A2" si="0">ROW()</f><v>1</v></c><c r="B1"><f t="array" ref="B1:B2">ROW(B1:B2)</f><v>1</v></c></row><row r="2"><c r="A2"><f t="shared" si="0"/><v>2</v></c><c r="B2"><v>2</v></c></row></sheetData>'
        ),
        "utf8"
      )
    );
    fs.writeFileSync(
      sourcePath,
      io.zipStore([...files].map(([name, data]) => ({ name, data })))
    );

    const opened = engine.dispatch("openWorkbook", { workspacePath: root, path: sourcePath });
    assert.equal(opened.meta.calculationStatus.status, "cached");
    assert.equal(opened.meta.calculationStatus.formulaCount, 4);
    const read = engine.dispatch("readRange", {
      workspacePath: root,
      workbookId: opened.meta.workbookId,
      sheetId: opened.meta.activeSheetId,
      a1: "A1:B2",
      maxCells: 4,
    });
    assert.equal(read.formulas.length, 4);
    assert.equal(read.formulas[2].formula, null);
    assert.equal(read.formulas[2].formulaEvidence, true);
    assert.equal(read.formulas[2].formulaType, "shared");
    assert.equal(read.formulas[3].formula, null);
    assert.equal(read.formulas[3].formulaType, "array");

    engine.dispatch("applyLocalEdit", {
      workspacePath: root,
      workbookId: opened.meta.workbookId,
      sheetId: opened.meta.activeSheetId,
      row: 1,
      col: 1,
      value: 9,
      expectedRevision: 0,
    });
    assert.throws(
      () => engine.dispatch("saveWorkbook", {
        workspacePath: root,
        workbookId: opened.meta.workbookId,
        path: copyPath,
        exportCopy: true,
        expectedRevision: 1,
      }),
      /COMPLEX_FORMULA_PATCH_UNSAFE/
    );
  });

  await t.test("preserves VBA package parts for value-only xlsm copies", (t) => {
    const root = tempWorkspace(t, "excel-engine-xlsm-");
    const sourcePath = writeInstrumentedExcelSource(root, { extension: ".xlsm" });
    const copyPath = path.join(root, "copy.xlsm");
    const workbook = io.readWorkbookFile(sourcePath);
    workbook.sheets[0].cells["0,0"] = { v: 8, t: "n" };
    const result = io.writeWorkbookFile(workbook, copyPath);
    assert.equal(result.mode, "source-preserving-cell-patch");
    const source = io.unzipBuffer(fs.readFileSync(sourcePath));
    const output = io.unzipBuffer(fs.readFileSync(copyPath));
    assert.deepEqual(output.get("xl/vbaProject.bin"), source.get("xl/vbaProject.bin"));
    assert.match(output.get("[Content_Types].xml").toString("utf8"), /macroEnabled/);
    assert.match(output.get("xl/_rels/workbook.xml.rels").toString("utf8"), /vbaProject/);
  });

  await t.test("strictly enforces Excel cell bounds and a workbook-wide parsed-cell budget", (t) => {
    const root = tempWorkspace(t, "excel-engine-xlsx-limits-");
    const edgePath = writeWorkbookWithCellRef(
      root,
      "edge.xlsx",
      `XFD${io.limits.excelMaxRows}`
    );
    const edge = io.readWorkbookFile(edgePath);
    assert.equal(
      edge.sheets[0].cells[`${io.limits.excelMaxRows - 1},${io.limits.excelMaxColumns - 1}`].v,
      1
    );

    const invalidRefs = [
      ["column-overflow.xlsx", "XFE1"],
      ["row-overflow.xlsx", `A${io.limits.excelMaxRows + 1}`],
      ["unsafe-integer.xlsx", "A9007199254740992"],
    ];
    for (const [fileName, cellRef] of invalidRefs) {
      const filePath = writeWorkbookWithCellRef(root, fileName, cellRef);
      assert.throws(() => io.readWorkbookFile(filePath), /XLSX_CELL_REF_LIMIT/);
    }

    const overBudgetPath = writeWorkbookWithSerializedCellCount(
      root,
      "cell-budget.xlsx",
      io.limits.maxParsedCells + 1
    );
    assert.throws(() => io.readWorkbookFile(overBudgetPath), /XLSX_CELL_COUNT_LIMIT/);
  });

  await t.test("bounds patch, accept, CSV parse, and dense export work", (t) => {
    const root = tempWorkspace(t, "excel-engine-operation-limits-");
    assert.throws(
      () => engine.dispatch("createWorkbook", {
        workspacePath: root,
        rows: io.limits.excelMaxRows + 1,
      }),
      /EXCEL_SHEET_LIMIT/
    );

    const created = engine.dispatch("createWorkbook", { workspacePath: root });
    const workbookId = created.meta.workbookId;
    const sheetId = created.meta.activeSheetId;
    assert.throws(
      () => engine.dispatch("proposePatch", {
        workspacePath: root,
        workbookId,
        sheetId,
        expectedRevision: 0,
        intent: "Reject an out-of-bounds cell",
        cells: [{ row: io.limits.excelMaxRows, col: 0, value: 1 }],
      }),
      /EXCEL_CELL_LIMIT/
    );

    const proposal = engine.dispatch("proposePatch", {
      workspacePath: root,
      workbookId,
      sheetId,
      expectedRevision: 0,
      intent: "Bound selection expansion",
      cells: [{ row: 0, col: 0, value: 1 }],
    });
    assert.throws(
      () => engine.dispatch("acceptProposal", {
        workspacePath: root,
        workbookId,
        proposalId: proposal.proposal.id,
        expectedRevision: 0,
        cellRefs: [`A1:XFD${io.limits.excelMaxRows}`],
      }),
      /ACCEPT_CELL_LIMIT/
    );

    assert.throws(
      () => csv.parseCsv("a,b\nc,d", { maxCells: 3 }),
      /CSV_CELL_COUNT_LIMIT/
    );

    const sparse = store.createEmpty({
      rows: io.limits.excelMaxRows,
      cols: io.limits.excelMaxColumns,
    });
    sparse.sheets[0].cells[
      `${io.limits.excelMaxRows - 1},${io.limits.excelMaxColumns - 1}`
    ] = { v: 1, t: "n" };
    assert.throws(() => io.sheetToMatrix(sparse.sheets[0]), /DENSE_EXPORT_CELL_LIMIT/);
  });

  await t.test("rejects oversized ZIP, CSV, and JSON sources before whole-file reads", (t) => {
    const root = tempWorkspace(t, "excel-engine-source-size-");
    const oversized = [
      ["oversized.xlsx", io.limits.maxZipFileBytes, /ZIP_FILE_SIZE_LIMIT/],
      ["oversized.csv", io.limits.maxCsvFileBytes, /CSV_FILE_SIZE_LIMIT/],
      ["oversized.json", io.limits.maxJsonFileBytes, /JSON_FILE_SIZE_LIMIT/],
    ];
    for (const [fileName, limit, expectedError] of oversized) {
      const filePath = path.join(root, fileName);
      writeSparseFile(filePath, limit + 1);
      assert.throws(() => io.readWorkbookFile(filePath), expectedError);
    }
  });

  await t.test("blocks direct, junction, symlink, and hard-link aliases of the imported source", (t) => {
    const root = tempWorkspace(t, "excel-engine-source-alias-");
    const realDirectory = path.join(root, "real");
    fs.mkdirSync(realDirectory);
    const sourcePath = writeInstrumentedExcelSource(realDirectory);
    const workbook = io.readWorkbookFile(sourcePath);
    const sourceHash = sha256(sourcePath);

    assert.throws(
      () => io.writeWorkbookFile(workbook, sourcePath, { allowLossyRebuild: true }),
      /SOURCE_TARGET_ALIAS_BLOCKED/
    );

    const hardLinkPath = path.join(root, "source-hard-link.xlsx");
    fs.linkSync(sourcePath, hardLinkPath);
    assert.throws(
      () => io.writeWorkbookFile(workbook, hardLinkPath, { allowLossyRebuild: true }),
      /SOURCE_TARGET_ALIAS_BLOCKED/
    );

    const aliasDirectory = path.join(root, "directory-alias");
    fs.symlinkSync(realDirectory, aliasDirectory, process.platform === "win32" ? "junction" : "dir");
    assert.throws(
      () => io.writeWorkbookFile(workbook, path.join(aliasDirectory, "source.xlsx"), {
        allowLossyRebuild: true,
      }),
      /SOURCE_TARGET_ALIAS_BLOCKED/
    );
    const safeAliasCopyPath = path.join(aliasDirectory, "copy.xlsx");
    const safeAliasCopy = io.writeWorkbookFile(workbook, safeAliasCopyPath);
    assert.equal(safeAliasCopy.path, safeAliasCopyPath);
    assert.equal(fs.existsSync(path.join(realDirectory, "copy.xlsx")), true);

    const symlinkPath = path.join(root, "source-symlink.xlsx");
    try {
      fs.symlinkSync(sourcePath, symlinkPath, "file");
      assert.throws(
        () => io.writeWorkbookFile(workbook, symlinkPath, { allowLossyRebuild: true }),
        /SOURCE_TARGET_ALIAS_BLOCKED/
      );
    } catch (error) {
      if (error?.code !== "EPERM") throw error;
      t.diagnostic("File symlink assertion skipped because this Windows account cannot create symlinks.");
    }
    assert.equal(sha256(sourcePath), sourceHash, "alias checks must leave the source unchanged");
  });

  await t.test("restores source round-trip fidelity across structural undo and redo", (t) => {
    const root = tempWorkspace(t, "excel-engine-fidelity-");
    const sourcePath = writeInstrumentedExcelSource(root, { withFormula: false });
    const opened = engine.dispatch("openWorkbook", { workspacePath: root, path: sourcePath });
    const workbookId = opened.meta.workbookId;
    const sheetId = opened.meta.activeSheetId;
    const inserted = engine.dispatch("insertRows", {
      workspacePath: root,
      workbookId,
      sheetId,
      at: 1,
      expectedRevision: 0,
    });
    assert.equal(inserted.meta.fidelity.canRoundTrip, false);
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
  });

  await t.test("guards stale formula CSV export and sanitizes text formula injection", (t) => {
    const root = tempWorkspace(t, "excel-engine-csv-");
    const created = engine.dispatch("createWorkbook", { workspacePath: root });
    const workbookId = created.meta.workbookId;
    const sheetId = created.meta.activeSheetId;
    engine.dispatch("applyLocalPatch", {
      workspacePath: root,
      workbookId,
      sheetId,
      cells: [
        { row: 0, col: 0, value: "=2+2" },
        { row: 0, col: 1, value: "+cmd" },
        { row: 0, col: 2, value: "-cmd" },
        { row: 0, col: 3, value: "@SUM(A1:A2)" },
        { row: 0, col: 4, value: "\t=evil" },
        { row: 0, col: 5, value: "\r=evil" },
        { row: 0, col: 6, formula: "=1+1", value: 2 },
      ],
      expectedRevision: 0,
    });
    const csvPath = path.join(root, "safe.csv");
    assert.throws(
      () => engine.dispatch("exportCsv", {
        workspacePath: root,
        workbookId,
        sheetId,
        path: csvPath,
        expectedRevision: 1,
      }),
      /STALE_FORMULA_VALUES_ACK_REQUIRED/
    );
    assert.equal(fs.existsSync(csvPath), false);

    const exported = engine.dispatch("exportCsv", {
      workspacePath: root,
      workbookId,
      sheetId,
      path: csvPath,
      acknowledgeStaleFormulaValues: true,
      expectedRevision: 1,
    });
    assert.equal(exported.formulaCount, 1);
    assert.equal(exported.sanitizedCellCount, 6);
    assert.match(exported.warning, /cached values .*may be stale/);
    assert.match(exported.warning, /formula-injection prefixes/);
    const csv = fs.readFileSync(csvPath, "utf8");
    assert.match(csv, /^'=2\+2,'\+cmd,'-cmd,'@SUM/);
    assert.match(csv, /'\t=evil/);
    assert.match(csv, /'\r=evil/);

    const uncached = engine.dispatch("createWorkbook", {
      workspacePath: root,
      title: "Uncached formula",
    });
    engine.dispatch("applyLocalEdit", {
      workspacePath: root,
      workbookId: uncached.meta.workbookId,
      sheetId: uncached.meta.activeSheetId,
      row: 0,
      col: 0,
      formula: "=1+1",
      expectedRevision: 0,
    });
    assert.throws(
      () => engine.dispatch("exportCsv", {
        workspacePath: root,
        workbookId: uncached.meta.workbookId,
        sheetId: uncached.meta.activeSheetId,
        acknowledgeStaleFormulaValues: true,
        expectedRevision: 1,
      }),
      /UNCACHED_FORMULA_CSV_BLOCKED/
    );
  });

  await t.test("requires revisions at mutation boundaries and isolates reload sessions by workspace", (t) => {
    const rootA = tempWorkspace(t, "excel-engine-workspace-a-");
    const rootB = tempWorkspace(t, "excel-engine-workspace-b-");
    const created = engine.dispatch("createWorkbook", { workspacePath: rootA, title: "Revision guard" });
    assert.throws(
      () => engine.dispatch("applyLocalEdit", {
        workspacePath: rootA,
        workbookId: created.meta.workbookId,
        sheetId: created.meta.activeSheetId,
        row: 0,
        col: 0,
        value: 1,
      }),
      /EXPECTED_REVISION_REQUIRED/
    );

    const sharedId = "shared_workspace_book";
    const sourceA = writeInstrumentedExcelSource(rootA, { withFormula: false });
    const sourceB = writeInstrumentedExcelSource(rootB, { withFormula: false });
    const workbookA = io.readWorkbookFile(sourceA, { workbookId: sharedId, title: "Workspace A" });
    const workbookB = io.readWorkbookFile(sourceB, { workbookId: sharedId, title: "Workspace B" });
    workbookA.title = "Workspace A";
    workbookB.title = "Workspace B";
    store.saveJson(rootA, workbookA);
    store.saveJson(rootB, workbookB);
    engine.sessions.clear();

    assert.equal(
      engine.dispatch("getMeta", { workspacePath: rootA, workbookId: sharedId }).meta.sourcePath,
      sourceA
    );
    const reloadedB = engine.dispatch("reloadWorkbook", {
      workspacePath: rootB,
      workbookId: sharedId,
      expectedRevision: 0,
    });
    assert.equal(reloadedB.meta.sourcePath, sourceB);
    assert.equal(reloadedB.meta.title, "Workspace B");
  });

  await t.test("separates Agent workspace paths from user-confirmed Product App exports", (t) => {
    const root = tempWorkspace(t, "excel-engine-path-policy-");
    const outside = tempWorkspace(t, "excel-engine-path-outside-");
    const externalSource = writeInstrumentedExcelSource(outside, { withFormula: false });

    assert.throws(
      () => engine.dispatch("openWorkbook", {
        workspacePath: root,
        path: externalSource,
        __trustedConsumerKind: "agentComponent",
      }),
      /WORKSPACE_PATH_REQUIRED/
    );
    const openedByUser = engine.dispatch("openWorkbook", {
      workspacePath: root,
      path: externalSource,
      __trustedConsumerKind: "productAppRuntime",
    });
    assert.equal(openedByUser.meta.sourcePath, externalSource);

    const created = engine.dispatch("createWorkbook", { workspacePath: root, title: "Export guard" });
    const target = path.join(root, "existing-unrelated.xlsx");
    fs.writeFileSync(target, "unrelated user file", "utf8");
    assert.throws(
      () => engine.dispatch("saveWorkbook", {
        workspacePath: root,
        workbookId: created.meta.workbookId,
        path: target,
        exportCopy: true,
        expectedRevision: 0,
        __trustedConsumerKind: "productAppRuntime",
      }),
      /EXISTING_TARGET_OVERWRITE_BLOCKED/
    );
    assert.equal(fs.readFileSync(target, "utf8"), "unrelated user file");
    assert.throws(
      () => engine.dispatch("saveWorkbook", {
        workspacePath: root,
        workbookId: created.meta.workbookId,
        path: target,
        exportCopy: true,
        expectedRevision: 0,
        overwriteExisting: true,
        __trustedConsumerKind: "agentComponent",
      }),
      /EXISTING_TARGET_OVERWRITE_BLOCKED/
    );
    assert.throws(
      () => engine.dispatch("saveWorkbook", {
        workspacePath: root,
        workbookId: created.meta.workbookId,
        path: target,
        exportCopy: true,
        expectedRevision: 0,
        overwriteExisting: true,
        expectedTargetFingerprint: {
          algorithm: "sha256",
          hash: "0".repeat(64),
          size: 0,
          mtimeMs: 0,
        },
        __trustedConsumerKind: "productAppRuntime",
      }),
      /EXPORT_TARGET_CHANGED/
    );

    engine.dispatch("saveWorkbook", {
      workspacePath: root,
      workbookId: created.meta.workbookId,
      path: target,
      exportCopy: true,
      expectedRevision: 0,
      overwriteExisting: true,
      __trustedConsumerKind: "productAppRuntime",
    });
    const persisted = store.loadJson(root, created.meta.workbookId);
    assert.equal(persisted.lastExportPath, target);
    assert.equal(persisted.lastExportFingerprint.algorithm, "sha256");
    assert.notEqual(fs.readFileSync(target, "utf8"), "unrelated user file");
  });

  await t.test("migrates old stores and leaves no temporary file after atomic replacement", (t) => {
    const root = tempWorkspace(t, "excel-engine-store-");
    const old = {
      workbookId: "wb_old",
      path: path.join(root, "old.xlsx"),
      title: "Old",
      sheets: [{ id: "s1", name: "Sheet1", rows: 5, cols: 5, cells: {} }],
      activeSheetId: "s1",
      dirty: true,
      focus: { sheetId: "s1", a1: "A1", kind: "cell" },
      proposal: null,
    };
    const migrated = store.normalizeWorkbook(old);
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.revision, 0);
    assert.equal(migrated.mode, "edit");
    assert.equal(migrated.sourceFormat, "xlsx");
    store.saveJson(root, migrated);
    store.saveJson(root, { ...migrated, title: "Old 2" });
    assert.deepEqual(fs.readdirSync(store.workbookDir(root, migrated.workbookId)), ["workbook.json"]);
    assert.equal(store.loadJson(root, migrated.workbookId).title, "Old 2");
  });
});
