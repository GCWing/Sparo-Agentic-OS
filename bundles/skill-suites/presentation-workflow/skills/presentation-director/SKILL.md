---
name: presentation-director
description: Direct one complete evidence-grounded presentation from a minimal topic brief through a frozen Markdown manuscript, Design Case, page-by-page visual production, whole-deck review, systemic revision, and validated PowerPoint export. Use for PPT Live generation and redesign work that needs both content quality and visual quality.
---

# Presentation Director

## Workflow

1. Start from the user's topic and optional materials. Infer audience, purpose, duration, page count, language, color direction, visual density, and evidence strategy. Ask only when an unknown materially changes the result.
2. Research before writing. Separate verified evidence, attributed opinion, inference, and unsupported material. Never invent metrics, quotations, sources, product facts, or customer claims.
3. Build the entire structured manuscript and speaker script in one pass, using stable `p01`-style slideIds. Commit both with `commit_presentation_manuscript`. The runtime validates the document, serializes canonical `manuscript.md` and `speaker-script.md`, and records the authoritative Manuscript revision.
4. Review the complete manuscript as one causal argument with `review_presentation_manuscript`. Repair narrative roots, not isolated sentences.
5. Create a topic-specific PresentationSystem. Color and density are inferred design decisions, not mandatory user fields.
6. Render one Design Case using three real pages from the frozen manuscript: opening/statement, evidence/process, and complex/closing. Never use placeholder copy.
7. Call `confirm_design_case` with the three rendered page references and wait for the dedicated confirmation card. The user makes the single approve-or-revise decision; a multimodal model may inspect the renders and offer a recommendation but does not bypass this card.
8. Prepare grounded media, charts, diagrams, and semantic SVG assets required by the complete manuscript.
9. Generate pages one by one with `generate_slide_visual`, in Manuscript order and against the approved case revision. Independently author each page's content hierarchy and layout from the Manuscript; Runtime does not inject or string-match the copy. Retry only for an explicit deterministic `RuleViolation`.
10. After all pages exist, prepare and commit one deck-wide review with `review_deck`. Compare every page against the complete Manuscript and speaker script, commit explicit alignment coverage, and use rendered evidence when multimodal; otherwise use the VisualInspectionBundle and report review coverage honestly.
11. Apply findings by root cause: manuscript, PresentationSystem, asset strategy, recipe family, or a bounded set of affected pages. Do not patch every page independently.
12. Export only exact passed deck/system/review revisions.

## Minimal input

Default input is a topic or task plus optional files, links, workspace paths, brand assets, or constraints. Do not ask users to choose fonts, recipes, layout names, page archetypes, palettes, or detailed slide structures. Offer color or density correction when the Design Case is shown.

## Manuscript contract

The complete semantic manuscript is committed before visual generation. Do not hand-author the managed Markdown syntax in an Agent tool call. For every page, supply:

- `slideId`: stable ordered identity (`p01`, `p02`, and so on).
- `title`: exact audience-facing title, never the page-role label.
- `coreClaim`: one precise, falsifiable or clearly framed claim.
- `visibleCopy`: final audience-facing copy items.
- `evidenceAndSources`: grounded sources, or `No external evidence; explicitly framed analysis.`
- `visualDirection`: `pageRole`, compatible `recipe`, `visualMode`, exact `evidenceObject`, `exportStrategy`, and concrete `artDirection`.
- `speakingObjective`: what the audience should understand or decide.

Bind every speaker-script entry to the same stable `slideId`; do not duplicate titles as identity. Allowed page roles are `cover`, `section`, `statement`, `evidence`, `comparison`, `process`, `architecture`, `media`, and `closing`. Every Design Case and visual page records the Manuscript revision and section hash it was designed from. Content and layout remain AI-authored; semantic consistency is judged by comparing the complete Manuscript and VisualDocument during whole-deck review.

## Content quality

- Build one causal argument, not a list of topics.
- Give every page one main claim and one audience job.
- Use exact nouns and verbs; remove unsupported generic claims.
- Distinguish fact, inference, recommendation, and aspiration.
- Cite the closest primary evidence. A source list alone does not support a claim.
- State uncertainty honestly when evidence is incomplete.
- End with a concrete conclusion, decision, or action.

## Visual quality

Derive PresentationSystem from subject matter, audience, content geometry, brand evidence, and delivery context. Define semantic colors, type roles, spacing, safe area, grid, shape grammar, media treatment, chart grammar, and page recipes.

Use `airy` density for keynote/vision narratives, `balanced` for most executive/product/strategy decks, and `dense` only for expert review or data-heavy decisions.

Avoid automatic card grids, decorative gradients, tiny supporting text, generic icon walls, repeated dark rounded rectangles, and identical page skeletons. Variation follows the argument and evidence object while the visual language remains coherent.

## Design Case

The Design Case is a decision artifact, not a theme picker. Show real palette, density, typography, media treatment, chart/diagram grammar, and page rhythm. Decisions may approve or request revision to color, density, visual language, or content structure. Never generate the complete deck while the case is awaiting a decision or rejected.

## Capability-aware review

Declare `multimodal` only when rendered pixels can actually be inspected. Otherwise declare `text-only`.

A text-only review uses the VisualInspectionBundle: ordered metadata, CanonicalRenderTree/SVG structure, geometry, text roles, resolved font metrics, token usage, asset metadata, reading order, rule violations, and render references. It may judge structure, consistency, traceability, declared hierarchy, and asset usage. It must not claim direct visual balance or color-harmony inspection.

AI `ReviewFinding`s are separate from deterministic runtime `RuleViolation`s. Each finding includes scope, evidence, severity, root-cause layer, and revision strategy.

## Runtime boundary

Use exact runtime revisions. Never edit private `.sparo_os` presentation state with filesystem tools. Runtime rules are limited to unambiguous schema, revision, reference, execution, asset safety, canvas, explicitly configured accessibility, and PowerPoint package integrity checks. Heuristic aesthetics never become blocking runtime rules.
