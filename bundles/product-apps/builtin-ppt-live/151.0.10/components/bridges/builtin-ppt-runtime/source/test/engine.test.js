const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { dispatch } = require("../src/engine");

async function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-ppt-live-manuscript-first-"));
  await dispatch("initializeWork", { title: "Activation Review" }, trusted(root));
  return root;
}

function trusted(root) {
  return { workspacePath: root, workId: "work-1", sessionId: "session-1" };
}

const PAGES = [
  { title: "Activation quality is the growth constraint", claim: "Acquisition is healthy while first-week activation declines.", metric: "-14%" },
  { title: "The break happens before first value", claim: "Most lost users leave before completing the first value action.", metric: "62%" },
  { title: "Shift the operating focus to first value", claim: "The next cycle should optimize first value rather than acquisition volume.", metric: "1 focus" },
];

function manuscript() {
  const sections = PAGES.map((page, index) => `## P${String(index + 1).padStart(2, "0")} | ${page.title}
### Core claim
${page.claim}

### Visible copy
- ${page.metric}
- Grounded supporting statement ${index + 1}.

### Evidence and sources
- workspace:test-evidence-${index + 1}

### Visual direction
- Page role: statement
- Recipe: statement-focus
- Visual mode: native
- Evidence object: ${page.metric} as the dominant decision signal
- Export strategy: native
- Art direction: Use one dominant metric, decisive left alignment, and a quiet supporting line.

### Speaking objective
Make the audience understand decision ${index + 1}.`).join("\n\n");
  return `---\npptManuscriptSchema: 4\nlanguage: en-US\n---\n\n# Activation Review\n\n${sections}\n`;
}

function speakerScript() {
  return `# Activation Review | Speaker Script\n\n${PAGES.map((page, index) => `## P${String(index + 1).padStart(2, "0")} | ${page.title}
### Read-aloud script
Complete delivery wording for page ${index + 1}.

### Transition
Continue to the next decision.`).join("\n\n")}\n`;
}

function structuredManuscript() {
  return {
    language: "en-US",
    title: "Activation Review",
    creativeBrief: {
      audience: "Product and growth leaders",
      purpose: "Choose the next activation priority",
      targetDuration: "12 minutes",
    },
    narrative: {
      opening: "Establish the activation constraint.",
      development: "Prove where first value breaks.",
      closing: "Land one operating focus.",
    },
    slides: PAGES.map((page, index) => ({
      slideId: `p${String(index + 1).padStart(2, "0")}`,
      title: page.title,
      coreClaim: page.claim,
      visibleCopy: [page.metric, `Grounded supporting statement ${index + 1}.`],
      evidenceAndSources: [`workspace:test-evidence-${index + 1}`],
      visualDirection: {
        pageRole: "statement",
        recipe: "statement-focus",
        visualMode: "native",
        evidenceObject: `${page.metric} as the dominant decision signal`,
        exportStrategy: "native",
        artDirection: "Use one dominant metric, decisive left alignment, and a quiet supporting line.",
      },
      speakingObjective: `Make the audience understand decision ${index + 1}.`,
    })),
  };
}

function structuredSpeakerScript() {
  return {
    language: "en-US",
    targetDurationMinutes: 12,
    slides: PAGES.map((page, index) => ({
      slideId: `p${String(index + 1).padStart(2, "0")}`,
      suggestedTime: "00:45",
      readAloudScript: `Complete delivery wording for page ${index + 1}.`,
      stageCues: ["[Pause]"],
      transition: "Continue to the next decision.",
    })),
  };
}

function slide(index, overrides = {}) {
  const page = PAGES[index];
  const visualTitle = overrides.title || page.title;
  const visualClaim = overrides.claim || page.claim;
  return {
    id: `p${String(index + 1).padStart(2, "0")}`,
    title: visualTitle,
    claim: visualClaim,
    pageRole: "statement",
    recipeId: "statement-focus",
    layoutMode: "recipe",
    visualMode: "native",
    visualPlan: "Use one dominant metric, decisive left alignment, and a quiet supporting line.",
    evidenceObject: `${page.metric} as the dominant decision signal`,
    exportStrategy: "native",
    sourceNote: `workspace:test-evidence-${index + 1}`,
    composition: {
      slots: [
        { id: `title-${index + 1}`, slotId: "title", type: "text", text: visualTitle },
        { id: `metric-${index + 1}`, slotId: "focal", type: "text", text: page.metric, style: { textRole: "metric", colorToken: "accent", valign: "middle" } },
        { id: `support-${index + 1}`, slotId: "support", type: "text", text: visualClaim },
      ],
    },
    ...overrides,
  };
}

async function commitAndReviewManuscript(root) {
  const initial = await dispatch("inspect", {}, trusted(root));
  const committed = await dispatch("commitPresentationDocument", {
    expectedManuscriptRevision: initial.documents.manuscript.revision,
    expectedSpeakerScriptRevision: initial.documents.speakerScript.revision,
    manuscript: structuredManuscript(),
    speakerScript: structuredSpeakerScript(),
    intent: "Commit the complete deck design document once",
  }, trusted(root));
  const prepared = await dispatch("reviewPresentationManuscript", { mode: "prepare" }, trusted(root));
  const reviewed = await dispatch("reviewPresentationManuscript", {
    mode: "commit",
    reviewId: prepared.reviewId,
    decision: "passed",
    findings: [],
  }, trusted(root));
  assert.equal(reviewed.status, "passed");
  return committed;
}

async function approveDesignCase(root) {
  const snapshot = await dispatch("inspect", {}, trusted(root));
  const designCase = await dispatch("renderDesignCase", {
    expectedManuscriptRevision: snapshot.manuscript.revision,
    expectedSystemRevision: snapshot.presentationSystem.revision,
    slides: [
      slide(0, { title: "Activation—not acquisition—is the constraint" }),
      slide(1, { title: "The loss happens before users reach first value" }),
      slide(2, { title: "One operating focus: accelerate first value" }),
    ],
  }, trusted(root));
  assert.notEqual(designCase.sampleSlides[0].title, snapshot.manuscript.slides[0].title);
  return dispatch("decideDesignCase", {
    caseId: designCase.caseId,
    decision: "approved",
    actor: "user",
    reviewCapability: "text-only",
    feedback: "Approved from the Surface",
  }, trusted(root));
}

async function generateAllPages(root) {
  let snapshot = await dispatch("inspect", {}, trusted(root));
  for (let index = 0; index < PAGES.length; index += 1) {
    const result = await dispatch("generateSlideVisual", {
      expectedDeckRevision: snapshot.deck.revision,
      expectedSlideRevision: 0,
      expectedSystemRevision: snapshot.presentationSystem.revision,
      expectedManuscriptRevision: snapshot.manuscript.revision,
      expectedDesignCaseRevision: snapshot.designCase.revision,
      slide: slide(index, { title: `${PAGES[index].title} — visual edit` }),
      intent: `Design page ${index + 1} from the current Manuscript`,
    }, trusted(root));
    assert.equal(result.slide.id, `p${String(index + 1).padStart(2, "0")}`);
    snapshot = await dispatch("inspect", {}, trusted(root));
  }
  return snapshot;
}

test("inspect never creates a blank presentation for an uninitialized Work", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sparo-ppt-live-missing-"));
  await assert.rejects(
    dispatch("inspect", {}, trusted(root)),
    (error) => error.code === "ppt_work_not_initialized",
  );
  assert.equal(fs.existsSync(path.join(root, "PPT")), false);
});

test("initializeWork creates one human-readable presentation directory", async () => {
  const root = await workspace();
  const presentationRoot = path.join(root, "PPT", "Activation Review");
  const control = JSON.parse(fs.readFileSync(path.join(presentationRoot, ".ppt-live.json"), "utf8"));
  const index = JSON.parse(fs.readFileSync(path.join(root, ".sparo_os", "ppt-index.json"), "utf8"));

  assert.equal(control.workId, "work-1");
  assert.equal(control.title, "Activation Review");
  assert.ok(control.state.deck);
  assert.ok(control.state.visualDocument);
  assert.ok(fs.existsSync(path.join(presentationRoot, "内容.md")));
  assert.ok(fs.existsSync(path.join(presentationRoot, "演讲稿.md")));
  assert.ok(fs.existsSync(path.join(presentationRoot, "设计说明.md")));
  assert.ok(fs.existsSync(path.join(presentationRoot, "assets")));
  assert.ok(fs.existsSync(path.join(presentationRoot, "preview")));
  assert.equal(index.works["work-1"], "PPT/Activation Review");
  assert.equal(fs.existsSync(path.join(presentationRoot, "documents")), false);
  assert.equal(fs.existsSync(path.join(presentationRoot, "system")), false);
  assert.equal(fs.existsSync(path.join(presentationRoot, "visual")), false);
});

test("attachWorkObject lets two Works operate on the same presentation", async () => {
  const root = await workspace();
  const source = await dispatch("inspect", {}, trusted(root));
  const targetTrusted = {
    ...trusted(root),
    workId: "work-2",
    workObjectId: "object-deck-1",
    sessionId: "session-2",
  };

  const attached = await dispatch("attachWorkObject", {
    sourceWorkId: "work-1",
  }, targetTrusted);

  assert.equal(attached.deck.deckId, source.deck.deckId);
  assert.deepEqual(attached.deck.slides, source.deck.slides);
  assert.equal(attached.project.root, source.project.root);
  const presentationDirectories = fs.readdirSync(path.join(root, "PPT"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  assert.equal(presentationDirectories.length, 1);
  const control = JSON.parse(fs.readFileSync(path.join(
    source.project.root,
    ".ppt-live.json",
  ), "utf8"));
  assert.equal(control.workId, "work-1");
  assert.equal(control.workObjectId, "object-deck-1");
  assert.ok(control.sessionRefs.includes("session-2"));

  await dispatch("commitPresentationDocument", {
    expectedManuscriptRevision: attached.documents.manuscript.revision,
    expectedSpeakerScriptRevision: attached.documents.speakerScript.revision,
    manuscript: structuredManuscript(),
    speakerScript: structuredSpeakerScript(),
    intent: "Continue editing the shared presentation from another Work",
  }, targetTrusted);
  const changedSource = await dispatch("inspect", {}, trusted(root));
  const changedTarget = await dispatch("inspect", {}, targetTrusted);
  assert.equal(changedSource.manuscript.revision, source.manuscript.revision + 1);
  assert.equal(changedTarget.manuscript.revision, changedSource.manuscript.revision);
});

test("inspect exposes the parsed Manuscript without a public Blueprint or hidden skill requirements", async () => {
  const root = await workspace();
  const result = await dispatch("inspect", {}, trusted(root));
  assert.equal(result.deck.revision, 0);
  assert.equal(result.manuscript.status, "committed");
  assert.equal(result.manuscript.slides.length, 1);
  assert.equal("contentBlueprint" in result, false);
  assert.equal(fs.existsSync(path.join(result.project.root, "system", "content-blueprint.json")), false);
  assert.equal(result.designCase.status, "notRendered");
  assert.deepEqual(result.reviewCapabilityProfile.supportedModes, ["multimodal", "text-only"]);
  assert.equal(result.authoringContract.schemaVersion, 4);
  assert.equal(result.authoringContract.agentSubmission, "structured");
  assert.equal(result.authoringContract.visualAuthorship, "ai-authored-from-manuscript");
  assert.equal(result.authoringContract.runtimeContentInjection, false);
  assert.ok(fs.existsSync(result.project.visualDocumentPath));
  assert.ok(fs.existsSync(result.documents.manuscript.path));
  const initialManuscript = await dispatch("getDocument", { documentId: "manuscript" }, trusted(root));
  const initialSpeaker = await dispatch("getDocument", { documentId: "speakerScript" }, trusted(root));
  assert.match(initialManuscript.document.content, /### Visual direction/);
  assert.doesNotMatch(initialManuscript.document.content, /### Visual intent/);
  const roundTripped = await dispatch("commitPresentationManuscript", {
    expectedManuscriptRevision: initialManuscript.document.revision,
    expectedSpeakerScriptRevision: initialSpeaker.document.revision,
    manuscript: initialManuscript.document.content,
    speakerScript: initialSpeaker.document.content,
    intent: "Round-trip the runtime-owned initial template",
  }, trusted(root));
  assert.equal(roundTripped.manuscript.slides.length, 1);
});

test("structured presentation document is serialized once as the authoritative Manuscript", async () => {
  const root = await workspace();
  const committed = await commitAndReviewManuscript(root);
  assert.equal(committed.manuscript.status, "committed");
  assert.equal(committed.manuscript.slides.length, 3);
  assert.deepEqual(committed.manuscript.slides.map((page) => page.slideId), ["p01", "p02", "p03"]);
  assert.equal("blueprint" in committed, false);
  assert.equal(committed.deck.slideCount, 0);
  assert.equal(committed.productionProgress.length, 3);
  const canonicalManuscript = await dispatch("getDocument", { documentId: "manuscript" }, trusted(root));
  const canonicalSpeaker = await dispatch("getDocument", { documentId: "speakerScript" }, trusted(root));
  assert.match(canonicalManuscript.document.content, /## P01 \| Activation quality is the growth constraint/);
  assert.match(canonicalManuscript.document.content, /### Core claim/);
  assert.match(canonicalSpeaker.document.content, /## P01 \| Activation quality is the growth constraint/);
  assert.equal("plan" in committed.deck, false);
  await assert.rejects(() => dispatch("commitDeckPlan", {}, trusted(root)), /Unsupported PPT Deck action/);
  await assert.rejects(() => dispatch("commitSlide", {}, trusted(root)), /Unsupported PPT Deck action/);
  await assert.rejects(() => dispatch("renderSlideReview", {}, trusted(root)), /Unsupported PPT Deck action/);
});

test("structured validation returns every contract violation in one non-mutating failure", async () => {
  const root = await workspace();
  const initial = await dispatch("inspect", {}, trusted(root));
  await assert.rejects(() => dispatch("commitPresentationDocument", {
    expectedManuscriptRevision: initial.documents.manuscript.revision,
    expectedSpeakerScriptRevision: initial.documents.speakerScript.revision,
    manuscript: {
      title: "",
      slides: [{
        slideId: "p09",
        title: "",
        coreClaim: "",
        visibleCopy: [],
        evidenceAndSources: [],
        visualDirection: {
          pageRole: "unknown",
          recipe: "",
          visualMode: "unknown",
          evidenceObject: "",
          exportStrategy: "unknown",
          artDirection: "",
        },
        speakingObjective: "",
      }],
    },
    speakerScript: { slides: [] },
    intent: "Reject the complete invalid document",
  }, trusted(root)), (error) => {
    assert.equal(error.code, "manuscript_contract_invalid");
    assert.ok(error.violations.length >= 12);
    const paths = new Set(error.violations.map((item) => item.path));
    assert.ok(paths.has("manuscript.title"));
    assert.ok(paths.has("manuscript.slides[0].slideId"));
    assert.ok(paths.has("manuscript.slides[0].coreClaim"));
    assert.ok(paths.has("speakerScript.slides"));
    return true;
  });
  const inspected = await dispatch("inspect", {}, trusted(root));
  assert.equal(inspected.manuscript.title, "Untitled presentation");
  assert.equal(inspected.deck.revision, 0);
});

test("text-only AI cannot decide the Design Case but an explicit user can", async () => {
  const root = await workspace();
  await commitAndReviewManuscript(root);
  const snapshot = await dispatch("inspect", {}, trusted(root));
  const designCase = await dispatch("renderDesignCase", {
    expectedManuscriptRevision: snapshot.manuscript.revision,
    expectedSystemRevision: snapshot.presentationSystem.revision,
    slides: [slide(0), slide(1), slide(2)],
  }, trusted(root));
  assert.equal(designCase.sampleSlides.length, 3);
  assert.ok(designCase.sampleSlides.every((item) => fs.existsSync(item.previewRef)));
  assert.ok(designCase.sampleSlides.every((item) => !("renderTree" in item)));
  assert.ok(designCase.sampleSlides.every((item) => item.nodeCount > 0));
  const agentSnapshot = await dispatch("inspect", { audience: "agent" }, trusted(root));
  assert.ok(agentSnapshot.designCase.sampleSlides.every((item) => !("renderTree" in item)));
  const surfaceSnapshot = await dispatch("inspect", {}, trusted(root));
  assert.ok(surfaceSnapshot.designCase.sampleSlides.every((item) => item.renderTree?.nodes?.length > 0));
  await assert.rejects(() => dispatch("decideDesignCase", {
    caseId: designCase.caseId,
    decision: "approved",
    actor: "ai",
    reviewCapability: "text-only",
  }, trusted(root)), /Text-only AI cannot/);
  const approved = await dispatch("decideDesignCase", {
    caseId: designCase.caseId,
    decision: "approved",
    actor: "user",
    reviewCapability: "text-only",
  }, trusted(root));
  assert.equal(approved.status, "approved");
});

test("composition validation reports all malformed slot payloads together", async () => {
  const root = await workspace();
  await commitAndReviewManuscript(root);
  const snapshot = await dispatch("inspect", {}, trusted(root));
  const invalid = slide(0, {
    composition: {
      slots: [
        { slotId: "title", kinds: ["text"], required: true },
        { slotId: "focal", kinds: ["text", "chart"], required: true },
        { slotId: "support", kinds: ["text"] },
      ],
    },
  });
  await assert.rejects(
    () => dispatch("renderDesignCase", {
      expectedManuscriptRevision: snapshot.manuscript.revision,
      expectedSystemRevision: snapshot.presentationSystem.revision,
      slides: [invalid, slide(1), slide(2)],
    }, trusted(root)),
    (error) => {
      assert.equal(error.code, "ppt_composition_invalid");
      assert.equal(error.contractVersion, 1);
      assert.ok(error.violations.filter((item) => item.code === "invalid_slot_element").length >= 3);
      assert.ok(error.violations.some((item) => item.code === "required_recipe_slot_missing"));
      return true;
    },
  );
});

test("independent page commits safely rebase a shared deck revision", async () => {
  const root = await workspace();
  await commitAndReviewManuscript(root);
  await approveDesignCase(root);
  const snapshot = await dispatch("inspect", {}, trusted(root));
  const common = {
    expectedDeckRevision: snapshot.deck.revision,
    expectedSlideRevision: 0,
    expectedSystemRevision: snapshot.presentationSystem.revision,
    expectedManuscriptRevision: snapshot.manuscript.revision,
    expectedDesignCaseRevision: snapshot.designCase.revision,
  };
  const first = await dispatch("generateSlideVisual", {
    ...common,
    slide: slide(0),
    intent: "Generate the first page from the shared baseline",
  }, trusted(root));
  const second = await dispatch("generateSlideVisual", {
    ...common,
    slide: slide(1),
    intent: "Generate the second page from the shared baseline",
  }, trusted(root));
  assert.equal(first.events[0].rebasedFromDeckRevision, null);
  assert.equal(second.events[0].rebasedFromDeckRevision, snapshot.deck.revision);
  assert.equal(second.events[0].deckRevisionBeforeCommit, first.deck.revision);
  assert.equal("renderTree" in second.slide, false);
  assert.equal("composition" in second.slide, false);
  assert.ok(second.slide.nodeCount > 0);
  assert.equal(second.deck.revision, snapshot.deck.revision + 2);
  assert.equal(second.deck.slideCount, 2);
});

test("rule violations have stable diagnostic ids and do not fail a committed page", async () => {
  const root = await workspace();
  await commitAndReviewManuscript(root);
  await approveDesignCase(root);
  const snapshot = await dispatch("inspect", {}, trusted(root));
  const evidenceSlide = slide(0, {
    pageRole: "evidence",
    recipeId: "evidence-split",
    visualMode: "chart",
    evidenceObject: "Activation evidence",
    exportStrategy: "native-chart",
    sourceNote: "",
    composition: {
      slots: [
        { id: "evidence-title", slotId: "title", type: "text", text: PAGES[0].title },
        {
          id: "evidence-chart",
          slotId: "evidence",
          type: "chart",
          text: "Activation trend",
          data: [{ label: "Previous", value: 100 }, { label: "Current", value: 86 }],
        },
        { id: "evidence-source", slotId: "source", type: "text", text: "Source shown in the visual only" },
      ],
    },
  });
  const result = await dispatch("generateSlideVisual", {
    expectedDeckRevision: snapshot.deck.revision,
    expectedSlideRevision: 0,
    expectedSystemRevision: snapshot.presentationSystem.revision,
    expectedManuscriptRevision: snapshot.manuscript.revision,
    expectedDesignCaseRevision: snapshot.designCase.revision,
    slide: evidenceSlide,
    intent: "Commit an evidence page with a deterministic source diagnostic",
  }, trusted(root));
  const violation = result.ruleViolations.find((item) => item.code === "evidence_source_missing");
  assert.match(violation.id, /^diagnostic-[a-f0-9]{20}$/);
  const inspectedAgain = await dispatch("inspect", {}, trusted(root));
  assert.equal(
    inspectedAgain.ruleViolations.find((item) => item.code === "evidence_source_missing").id,
    violation.id,
  );
});

test("a post-write inspection failure rolls back deck, visual document, and history", async () => {
  const root = await workspace();
  await commitAndReviewManuscript(root);
  await approveDesignCase(root);
  const before = await dispatch("inspect", {}, trusted(root));
  const controlFile = path.join(before.project.root, ".ppt-live.json");
  const originalRename = fs.renameSync;
  let injected = false;
  fs.renameSync = function renameWithInjectedFailure(source, destination) {
    if (!injected && path.resolve(destination) === path.resolve(controlFile)) {
      const candidate = JSON.parse(fs.readFileSync(source, "utf8"));
      if (candidate.state?.deck?.slides?.length === 1 && candidate.state?.visualDocument?.pages?.length === 1) {
        injected = true;
        throw new Error("Injected post-write inspection failure");
      }
    }
    return originalRename.call(fs, source, destination);
  };
  try {
    await assert.rejects(() => dispatch("generateSlideVisual", {
      expectedDeckRevision: before.deck.revision,
      expectedSlideRevision: 0,
      expectedSystemRevision: before.presentationSystem.revision,
      expectedManuscriptRevision: before.manuscript.revision,
      expectedDesignCaseRevision: before.designCase.revision,
      slide: slide(0),
      intent: "Exercise transactional rollback",
    }, trusted(root)), /Injected post-write inspection failure/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(injected, true);
  const after = await dispatch("inspect", {}, trusted(root));
  assert.equal(after.deck.revision, before.deck.revision);
  assert.equal(after.deck.slideCount, 0);
  assert.equal(after.visualDocument.pageCount, 0);
  assert.deepEqual(after.history, before.history);
});

test("page visuals are generated in manuscript order without per-page aesthetic review", async () => {
  const root = await workspace();
  await commitAndReviewManuscript(root);
  await approveDesignCase(root);
  const snapshot = await dispatch("inspect", {}, trusted(root));
  await assert.rejects(() => dispatch("generateSlideVisual", {
    expectedDeckRevision: snapshot.deck.revision,
    expectedSlideRevision: 0,
    expectedSystemRevision: snapshot.presentationSystem.revision,
    expectedManuscriptRevision: snapshot.manuscript.revision,
    expectedDesignCaseRevision: snapshot.designCase.revision,
    slide: slide(1),
    intent: "Attempt out-of-order generation",
  }, trusted(root)), /Generate 'p01' before 'p02'/);
  const generated = await generateAllPages(root);
  assert.equal(generated.deck.slideCount, 3);
  assert.equal(generated.visualDocument.pageCount, 3);
  assert.deepEqual(generated.ruleViolations, []);
  assert.ok(generated.ruleViolations.every((item) => !["slide_plan_mismatch", "slide_plan_order_mismatch"].includes(item.code)));
  assert.equal(generated.deck.slides[0].title, `${PAGES[0].title} — visual edit`);
  assert.notEqual(generated.deck.slides[0].title, generated.manuscript.slides[0].title);
  assert.equal(generated.deck.slides[0].sourceRevision, generated.manuscript.revision);
  const firstSlide = generated.deck.slides[0];
  const firstNode = firstSlide.renderTree.nodes[0];
  await assert.rejects(() => dispatch("editVisual", {
    expectedRevision: generated.deck.revision,
    expectedSlideRevision: firstSlide.revision,
    expectedVisualRevision: firstSlide.visualRevision,
    operation: "updateNode",
    slideId: firstSlide.id,
    nodeId: firstNode.id,
    nodePatch: { text: "Bypass the frozen manuscript" },
    intent: "Attempt page-local semantic edit",
  }, trusted(root)), /unsupported field 'text'/);
});

test("whole-deck text review records honest coverage and exports the exact passed PPTX", async () => {
  const root = await workspace();
  await commitAndReviewManuscript(root);
  await approveDesignCase(root);
  const generated = await generateAllPages(root);
  const prepared = await dispatch("reviewDeck", {
    mode: "prepare",
    expectedDeckRevision: generated.deck.revision,
    expectedSystemRevision: generated.presentationSystem.revision,
    expectedManuscriptRevision: generated.manuscript.revision,
  }, trusted(root));
  assert.equal(prepared.status, "awaitingAiReview");
  assert.equal(prepared.visualInspectionBundle.pages.length, 3);
  assert.equal(prepared.visualInspectionBundle.manuscript.slides.length, 3);
  assert.equal(prepared.visualInspectionBundle.alignmentReview.mode, "ai-semantic-comparison");
  assert.equal(prepared.manuscriptRevision, generated.manuscript.revision);
  assert.ok(fs.existsSync(prepared.contactSheetRef));
  await assert.rejects(() => dispatch("reviewDeck", {
    mode: "commit",
    reviewId: prepared.reviewId,
    decision: "passed",
    findings: [],
    reviewCoverage: {
      mode: "text-only",
      evidenceMode: "visual-inspection-bundle",
      inspectedSlideIds: ["p01", "p02", "p03"],
    },
  }, trusted(root)), /alignmentCoverage/);
  const reviewed = await dispatch("reviewDeck", {
    mode: "commit",
    reviewId: prepared.reviewId,
    decision: "passed",
    findings: [],
    reviewCoverage: {
      mode: "text-only",
      evidenceMode: "visual-inspection-bundle",
      inspectedSlideIds: ["p01", "p02", "p03"],
      limitations: "No direct pixel inspection was performed.",
    },
    alignmentCoverage: {
      inspectedManuscriptSlideIds: ["p01", "p02", "p03"],
      checks: [
        "core-claim-preservation",
        "evidence-and-source-fidelity",
        "appropriate-content-restructuring",
        "narrative-continuity",
        "speaker-script-alignment",
        "unsupported-claim-detection",
      ],
      summary: "All AI-authored visual pages preserve the Manuscript meaning and evidence while adapting copy for visual delivery.",
    },
  }, trusted(root));
  assert.equal(reviewed.status, "passed");
  assert.equal(reviewed.reviewCoverage.mode, "text-only");
  assert.equal(reviewed.alignmentCoverage.checks.length, 6);
  const exported = await dispatch("export", {
    format: "pptx",
    expectedDeckRevision: generated.deck.revision,
    expectedSystemRevision: generated.presentationSystem.revision,
    reviewId: reviewed.reviewId,
    filename: "activation-review",
  }, trusted(root));
  assert.equal(exported.artifact.validation.status, "passed");
  assert.equal(exported.artifact.validation.slideCount, 3);
  assert.ok(fs.existsSync(exported.artifact.path));
  assert.equal(path.dirname(exported.artifact.path), path.join(root, "PPT", "Activation Review"));
  const control = JSON.parse(fs.readFileSync(path.join(path.dirname(exported.artifact.path), ".ppt-live.json"), "utf8"));
  assert.equal(control.presentationFile, "activation-review.pptx");
});

test("runtime rejects non-Markdown input but does not expose heuristic aesthetic diagnostics", async () => {
  const root = await workspace();
  const initial = await dispatch("inspect", {}, trusted(root));
  await assert.rejects(() => dispatch("commitPresentationManuscript", {
    expectedManuscriptRevision: initial.documents.manuscript.revision,
    expectedSpeakerScriptRevision: initial.documents.speakerScript.revision,
    manuscript: "# Bad\n<script>alert(1)</script>",
    speakerScript: "# Script",
    intent: "invalid input",
  }, trusted(root)), /pure Markdown/);
  const inspected = await dispatch("inspect", {}, trusted(root));
  const forbidden = new Set(["weak_visual_hierarchy", "repetitive_card_grid", "underdeveloped_composition", "overcrowded_composition", "edge_pressure", "repeated_composition", "design_token_coverage_low"]);
  assert.ok(inspected.ruleViolations.every((item) => !forbidden.has(item.code)));
});
