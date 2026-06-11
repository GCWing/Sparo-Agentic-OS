//! User prompt builder for PPT Live backend runs via the Sparo Agent (`agentic`).

use serde_json::Value;

/// Build the user prompt for a PPT Live generation/edit run.
///
/// `input.phase` selects the staged-pipeline protocol:
/// - `"plan"`: research + outline + design system + per-slide briefs, no HTML.
/// - `"slides"`: render the assigned slides from a finished plan, no research.
/// - absent: legacy single-shot protocol (full deck or incremental patch).
pub fn build_ppt_live_private_prompt(input: &Value) -> String {
    match input.get("phase").and_then(Value::as_str) {
        Some("plan") => return build_ppt_live_plan_prompt(input),
        Some("slides") => return build_ppt_live_slides_prompt(input),
        _ => {}
    }
    let body = format!(
        r##"Generate or revise a PPT Live deck. The user only sees the PPT Live app UI.

1. Call `Skill('ppt-design')` — the Sparo built-in PPT design skill — and follow it end-to-end. Never substitute any other presentation or PPT skill, even if one appears in the available skills list; ignore user-installed PPT design skills entirely for this run.
2. Use any Sparo tools you need (WebFetch, WebSearch, etc.) when the user's prompt requires external facts.
3. Finish with **only** one strict JSON object — no Markdown fences, no commentary, no tool calls in the final message.

Every slide must include complete `slides[].html`: self-contained 960pt × 540pt HTML with inline CSS (ppt-design editable PPTX rules). Slide copy must be audience-ready, never placeholder instructions.

Return JSON matching this shape:
{{
  "title": "deck title",
  "language": "zh-CN or en-US",
  "outline": ["slide title"],
  "researchReport": {{
    "summary": "short internal summary safe to show as a product status detail",
    "verifiedFacts": ["fact with source note when available"],
    "assumptions": ["clearly marked assumption"],
    "warnings": ["source or verification warning"]
  }},
  "design": {{
    "stylePhilosophy": "pentagram|muller-brockmann|build|kenya-hara|takram",
    "theme": "light|dark",
    "palette": {{
      "background": "#FAFAF7",
      "ink": "#1A1A1A",
      "muted": "#666666",
      "primary": "#111111",
      "accent": "#C84B31",
      "panel": "#FFFFFF"
    }},
    "layoutPrinciples": ["specific visual rules used for this deck"]
  }},
  "slides": [
    {{
      "role": "cover|content|data|transition|closing",
      "narrativeStage": "hook|progression|climax|landing",
      "title": "concrete slide title",
      "kicker": "short page type",
      "claim": "one core message",
      "proofObject": "source-backed proof or visual direction",
      "supportNote": "source fact, assumption, or verification note",
      "sourceNote": "source URL/name or verification note",
      "facts": ["verified fact or clearly marked assumption"],
      "bullets": ["short visible bullet"],
      "metric": {{ "value": "", "label": "" }},
      "chartData": [],
      "notes": "speaker notes",
      "layout": "cover|brief|evidence|process|comparison|quote|data|closing",
      "visualTreatment": "typographic|grid|editorial|white-space|soft-tech|data|process|comparison",
      "html": "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"UTF-8\"><style>body{{width:960pt;height:540pt;margin:0;overflow:hidden;...}}</style></head><body>...</body></html>"
    }}
  ]
}}

Input JSON:
```json
{input_json}
```"##,
        input_json = serde_json::to_string_pretty(input).unwrap_or_else(|_| "{}".to_string())
    );
    format!(
        "{body}{}{}",
        build_ppt_live_operation_appendix(input),
        build_ppt_live_style_appendix(input)
    )
}

/// Plan phase: research, narrative spine, design system, and per-slide briefs.
/// Deliberately excludes HTML so the run is fast and cheap to retry.
fn build_ppt_live_plan_prompt(input: &Value) -> String {
    let body = format!(
        r##"Plan a PPT Live deck. This is the PLANNING phase of a staged pipeline: research the topic, lock the narrative, and write a per-slide brief. Slide HTML is produced later by separate render runs that follow your plan exactly, so the plan must be complete and self-sufficient.

1. Call `Skill('ppt-design')` — the Sparo built-in PPT design skill — and follow its narrative, density, and design-system rules when planning. Never substitute any other presentation or PPT skill.
2. Use any Sparo tools you need (WebFetch, WebSearch, Read, etc.) when the user's prompt requires external facts. All research happens NOW; render runs are forbidden from re-researching.
3. Finish with **only** one strict JSON object — no Markdown fences, no commentary, no tool calls in the final message.
4. Do NOT generate any slide HTML in this phase.

Return JSON matching this shape:
{{
  "title": "deck title",
  "language": "zh-CN or en-US",
  "outline": ["slide title"],
  "researchReport": {{
    "summary": "short internal summary safe to show as a product status detail",
    "verifiedFacts": ["fact with source note when available"],
    "assumptions": ["clearly marked assumption"],
    "warnings": ["source or verification warning"]
  }},
  "design": {{
    "stylePhilosophy": "pentagram|muller-brockmann|build|kenya-hara|takram",
    "theme": "light|dark",
    "palette": {{
      "background": "#FAFAF7",
      "ink": "#1A1A1A",
      "muted": "#666666",
      "primary": "#111111",
      "accent": "#C84B31",
      "panel": "#FFFFFF"
    }},
    "layoutPrinciples": ["specific visual rules every slide of this deck must share"]
  }},
  "slidePlans": [
    {{
      "slideNumber": 1,
      "role": "cover|content|data|transition|closing",
      "narrativeStage": "hook|progression|climax|landing",
      "title": "concrete slide title",
      "kicker": "short page type",
      "claim": "one core message",
      "proofObject": "source-backed proof or visual direction",
      "supportNote": "source fact, assumption, or verification note",
      "sourceNote": "source URL/name or verification note",
      "facts": ["verified fact or clearly marked assumption"],
      "bullets": ["short visible bullet"],
      "metric": {{ "value": "", "label": "" }},
      "chartData": [],
      "notes": "speaker notes",
      "layout": "cover|brief|evidence|process|comparison|quote|data|closing",
      "visualTreatment": "typographic|grid|editorial|white-space|soft-tech|data|process|comparison",
      "contentBrief": "everything the render run needs to build this slide without asking questions: the exact copy or copy direction, the data values to visualize and the recommended visual form (table/bar/column/pie/SWOT/flow/timeline/big-number/structured text), and the layout intent"
    }}
  ]
}}

Plan rules:
- `slidePlans` must cover the full deck in final order; `slideNumber` is one-based and contiguous.
- Every `contentBrief` must be concrete enough that a render run with no research access can produce an audience-ready slide from it. Put real numbers, names, and source notes into the briefs, not vague directions.
- `design.layoutPrinciples` and `design.palette` are the consistency contract across parallel render runs — make them specific.

Output budget (hard limits — the plan JSON is streamed over a connection that gets cut after several minutes, so an oversized plan ALWAYS fails and wastes the entire run):
- Write dense, telegraphic notes, never prose paragraphs. Pack facts, numbers, and names; drop filler words.
- `contentBrief`: at most ~400 characters per slide.
- `facts`: at most 4 items; `bullets`: at most 4 items; each item one short line.
- `proofObject`, `supportNote`, `sourceNote`, `notes`: one short sentence each.
- `researchReport.summary`: at most ~600 characters; `verifiedFacts`/`assumptions`/`warnings`: at most 12 short items combined.
- Total plan JSON must stay under ~25,000 characters even for large decks. If the deck is big, make each brief tighter instead of dropping slides.

Input JSON:
```json
{input_json}
```"##,
        input_json = serde_json::to_string_pretty(input).unwrap_or_else(|_| "{}".to_string())
    );
    format!("{body}{}", build_ppt_live_style_appendix(input))
}

/// Slides phase: render the assigned slides from a finished plan. No research,
/// no plan changes — just faithful, high-quality HTML production, so failed or
/// parallel batches can be retried independently.
fn build_ppt_live_slides_prompt(input: &Value) -> String {
    let assigned = input
        .get("assignedSlides")
        .and_then(Value::as_array)
        .map(|slides| {
            slides
                .iter()
                .filter_map(|slide| slide.get("slideNumber").and_then(Value::as_u64))
                .map(|number| number.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let body = format!(
        r##"Render PPT Live slides. This is the RENDER phase of a staged pipeline. The plan (research, outline, design system, per-slide briefs) is already final and is provided in the input JSON as `plan`. Your batch must render ONLY the slides listed in `assignedSlides` (slide numbers: {assigned}).

1. Call `Skill('ppt-design')` — the Sparo built-in PPT design skill — and follow it end-to-end for slide HTML quality. Never substitute any other presentation or PPT skill.
2. Do NOT re-research. Do not call WebSearch or WebFetch. Trust `plan.researchReport` and each slide's `contentBrief` completely; they contain all verified facts.
3. Do NOT change the plan: keep each assigned slide's `slideNumber`, title, claim, layout, and narrative role as planned. Apply `plan.design` (philosophy, theme, palette, layoutPrinciples) to every slide so parallel batches stay visually identical.
4. Finish with **only** one strict JSON object — no Markdown fences, no commentary, no tool calls in the final message.

Every slide must include complete `html`: self-contained 960pt × 540pt HTML with inline CSS (ppt-design editable PPTX rules). Slide copy must be audience-ready, never placeholder instructions.

Return JSON matching this shape:
{{
  "slides": [
    {{
      "slideNumber": 1,
      "role": "cover|content|data|transition|closing",
      "narrativeStage": "hook|progression|climax|landing",
      "title": "concrete slide title",
      "kicker": "short page type",
      "claim": "one core message",
      "proofObject": "source-backed proof or visual direction",
      "supportNote": "source fact, assumption, or verification note",
      "sourceNote": "source URL/name or verification note",
      "facts": ["verified fact or clearly marked assumption"],
      "bullets": ["short visible bullet"],
      "metric": {{ "value": "", "label": "" }},
      "chartData": [],
      "notes": "speaker notes",
      "layout": "cover|brief|evidence|process|comparison|quote|data|closing",
      "visualTreatment": "typographic|grid|editorial|white-space|soft-tech|data|process|comparison",
      "html": "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"UTF-8\"><style>body{{width:960pt;height:540pt;margin:0;overflow:hidden;...}}</style></head><body>...</body></html>"
    }}
  ]
}}

Render rules:
- Return exactly the slides listed in `assignedSlides`, in ascending `slideNumber` order, and no others. If `completedSlides` is present in the input, those slides are already done — never regenerate them.
- Emit each slide's JSON object completely before starting the next one, so partial output remains recoverable.
- Keep the HTML compact: no HTML comments, no unused CSS rules, minimal whitespace and indentation. The response is streamed over a connection that gets cut after several minutes, so wasted characters risk failing the whole batch. Density of CONTENT is good; padding of MARKUP is not.

Input JSON:
```json
{input_json}
```"##,
        input_json = serde_json::to_string_pretty(input).unwrap_or_else(|_| "{}".to_string())
    );
    format!("{body}{}", build_ppt_live_style_appendix(input))
}

fn build_ppt_live_style_appendix(input: &Value) -> String {
    let font = input
        .get("style")
        .and_then(|value| value.get("fontFamily"))
        .and_then(Value::as_str)
        .unwrap_or("sans");
    let density_raw = input
        .get("style")
        .and_then(|value| value.get("density"))
        .and_then(Value::as_str)
        .unwrap_or("standard");
    let density = if density_raw == "loose" {
        "spacious"
    } else {
        density_raw
    };
    let color_mode = input
        .get("style")
        .and_then(|value| value.get("colorMode"))
        .and_then(Value::as_str)
        .unwrap_or("light");
    let style_preset = input
        .get("style")
        .and_then(|value| value.get("stylePreset"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let palette = input.get("style").and_then(|value| value.get("palette"));

    let font_rule = if font == "serif" {
        "serif — use serif typography in every slide HTML (for example Georgia, \"Songti SC\", \"Times New Roman\", Cambria). Avoid sans-serif body copy."
    } else {
        "sans-serif — use clean sans-serif typography in every slide HTML (for example system-ui, \"PingFang SC\", \"Microsoft YaHei\", Arial, Helvetica). Avoid serif body copy."
    };

    let density_rule = match density {
        "compact" => {
            "compact — information-forward: body padding 24-32px, line-height 1.2-1.28, and 4-6 concise bullets, metrics, or a two-column grid when the content supports it. Prefer readable tightness over decorative whitespace; never overflow the slide."
        }
        "spacious" => {
            "spacious — the loosest tier, still content-rich: body padding 44-52px, line-height 1.32-1.4, and 2-4 concise bullets or 2-3 short content blocks per slide. Keep clear hierarchy without leaving large empty regions."
        }
        _ => {
            "standard — balanced professional density: body padding 34-42px, line-height 1.26-1.34, and 3-5 bullets, metrics, or paired columns when useful. Use whitespace to separate sections, not to leave half the slide blank."
        }
    };

    let color_rule = if color_mode == "dark" {
        "dark — use dark slide backgrounds with light text, high-contrast panels, and a keynote-style atmosphere. Set design.theme to dark and reflect it in every slides[].html background, text, and panel colors."
    } else {
        "light — use light slide backgrounds with dark text, clean readable contrast, and a professional presentation look. Set design.theme to light and reflect it in every slides[].html background, text, and panel colors."
    };

    let mut style_rules = format!(
        "\n\n## Presentation style preferences (must follow in slides[].html)\n\n- Font family: {font_rule}\n- Information density: {density_rule}\n- Slide color mode: {color_rule}\n\
\n## Hard layout rules (apply to every slides[].html, any style)\n\n\
- Zero overflow, enforced by budget: before writing each slide, budget the vertical space — title block 70-95pt + footer 20-25pt + a mandatory >=36pt (0.5in) bottom safety margin leaves only ~390-420pt for body content. Estimate every block as `lines x font-size x line-height + paddings` (tables as `rows x row-height`); if the sum exceeds the body budget, cut rows, merge columns, or split the slide. Never shrink fonts below 10px to force-fit content.\n\
- Structural clipping fallback: set `body {{ overflow: hidden; }}`, make the root a `display:flex; flex-direction:column; height:540pt;` container, and give the stretchable content area `flex:1; min-height:0; overflow:hidden;` so a misestimate clips inside its container instead of overflowing the canvas. Every text box larger than 12px must end >=0.5in above the canvas bottom.\n\
- Choose the representation by content shape, judged per slide by which form communicates fastest: comparisons -> tables/matrices, rankings -> CSS horizontal bar charts, trends -> CSS column charts, composition -> `conic-gradient` pie/donut, strategy -> SWOT/2x2 grids, processes -> flow diagrams with CSS arrows, milestones -> timelines, single KPIs -> big-number callouts; qualitative reasoning or narrative stays as structured text. Do not write paragraphs where a visual is clearly faster, and do not force decorative charts onto purely qualitative content. Pure HTML/CSS only, label every bar/segment with its value, and pair each visual with a one-line takeaway.\n"
    );

    // Inject style preset guidance if provided. The preset spec lives inside the
    // ppt-design skill so the run stays anchored to the skill's quality system.
    if !style_preset.is_empty() {
        style_rules.push_str(&format!(
            "\n- Style preset: `{style_preset}`. After loading the ppt-design skill, `Read` its `references/style-presets/{style_preset}.md` (the path is relative to the skill directory reported by the Skill tool) and apply that file in full to every slides[].html: visual identity (palette, typography mood, decorative language, recommended layouts) plus any information-density, language, and page-structure rules the preset defines. When the preset's density or structure rules conflict with the generic density preference above, the preset wins.\n"
        ));
        if let Some(p) = palette {
            if let Ok(palette_json) = serde_json::to_string(p) {
                style_rules.push_str(&format!("- Style palette (matches the preset; use these exact colors for backgrounds, text, accents, and panels in every slide HTML): {palette_json}\n"));
            }
        }
        style_rules.push_str(
            "- The preset does not suspend the ppt-design core rules: assertion-led titles, one core message per slide, anti-AI-slop rules, the 960pt x 540pt canvas, editable-PPTX constraints, and zero content overflow all still apply.\n- Pick the closest of the skill's five design philosophies as the structural grammar for layout, then skin it with the preset. If the preset file cannot be read, keep the palette above and fall back to that philosophy.\n",
        );
    }

    style_rules
}

fn ppt_live_has_current_deck(input: &Value) -> bool {
    input
        .get("currentDeck")
        .and_then(|deck| deck.get("slides"))
        .and_then(Value::as_array)
        .is_some_and(|slides| !slides.is_empty())
}

fn build_ppt_live_operation_appendix(input: &Value) -> String {
    let operation = input
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("auto");
    let has_current_deck = ppt_live_has_current_deck(input);
    if !has_current_deck {
        return format!(
            "\n\n## Current operation\n\n- Operation: {operation}\n- No current deck was provided. This is a first-pass deck generation run. Return a complete `slides` array.\n"
        );
    }

    format!(
        r#"

## Current operation

- Operation: {operation}
- `currentDeck` is provided. Treat the user instruction as an incremental editing request for the existing deck unless the instruction explicitly asks for a completely new deck.
- `currentDeck.slides[].slideIndex` is zero-based. `currentDeck.slides[].slideNumber` is one-based and matches what users usually say.
- Use `currentDeck.activeSlideIndex` when the instruction says "current slide", "this page", "本页", "当前页", or similar.
- Decide the affected slide or slides yourself from the instruction, `currentDeck.targetHints`, slide titles, claims, notes, and visible text. Do not ask the user which pages to edit.
- Preserve unchanged slides exactly by returning a patch instead of regenerating them.
- Prefer `deckPatch` for revision, insertion, and deletion. Return a full `slides` array only when the user asks for a whole-deck rewrite or the requested change naturally affects most slides.

For incremental edits, return this optional patch shape instead of `slides`:
{{
  "title": "existing or updated deck title",
  "language": "zh-CN or en-US",
  "outline": ["updated slide title list, optional"],
  "researchReport": {{
    "summary": "what changed",
    "verifiedFacts": [],
    "assumptions": [],
    "warnings": []
  }},
  "design": {{ "stylePhilosophy": "pentagram|muller-brockmann|build|kenya-hara|takram", "theme": "light|dark", "palette": {{}}, "layoutPrinciples": [] }},
  "deckPatch": {{
    "rationale": "why these slides were selected",
    "changedSlideIndexes": [0],
    "changes": [
      {{
        "op": "replace_slide|insert_slide|delete_slide",
        "slideId": "existing slide id for replace/delete",
        "slideIndex": 0,
        "slideNumber": 1,
        "afterSlideId": "existing slide id for insert, optional",
        "slide": {{
          "id": "reuse the existing id for replace; create a stable id only for insert",
          "role": "cover|content|data|transition|closing",
          "narrativeStage": "hook|progression|climax|landing",
          "title": "concrete slide title",
          "kicker": "short page type",
          "claim": "one core message",
          "proofObject": "source-backed proof or visual direction",
          "supportNote": "source fact, assumption, or verification note",
          "sourceNote": "source URL/name or verification note",
          "facts": ["verified fact or clearly marked assumption"],
          "bullets": ["short visible bullet"],
          "metric": {{ "value": "", "label": "" }},
          "chartData": [],
          "notes": "speaker notes",
          "layout": "cover|brief|evidence|process|comparison|quote|data|closing",
          "visualTreatment": "typographic|grid|editorial|white-space|soft-tech|data|process|comparison",
          "html": "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"UTF-8\"><style>body{{width:960pt;height:540pt;margin:0;overflow:hidden;...}}</style></head><body>...</body></html>"
        }}
      }}
    ]
  }}
}}

Patch rules:
- `replace_slide`: include a complete replacement `slide` with mandatory `html`; reuse the original slide id.
- `insert_slide`: include a complete new `slide` with mandatory `html`; place it with `afterSlideId`, `beforeSlideId`, `slideIndex`, or `slideNumber`.
- `delete_slide`: do not include `slide`; target by `slideId` plus index/number when available.
- Never return an empty patch. If no change is needed, still make the smallest useful improvement requested by the user.
- If you return a full `slides` array during an edit, it must include every final slide in order. Missing unchanged slides will be treated as deleted.
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_uses_sparo_agent_skill_workflow() {
        let prompt = build_ppt_live_private_prompt(&serde_json::json!({ "operation": "auto" }));

        assert!(prompt.contains("Skill('ppt-design')"));
        assert!(prompt.contains("Sparo built-in PPT design skill"));
        assert!(prompt.contains("Never substitute any other presentation or PPT skill"));
        assert!(prompt.contains("Use any Sparo tools you need"));
        assert!(!prompt.contains("at most **once**"));
    }

    #[test]
    fn prompt_without_current_deck_requires_complete_generation() {
        let prompt = build_ppt_live_private_prompt(&serde_json::json!({ "operation": "auto" }));

        assert!(prompt.contains("No current deck was provided"));
        assert!(prompt.contains("Return a complete `slides` array"));
    }

    #[test]
    fn prompt_with_style_preset_routes_through_skill_style_reference() {
        let prompt = build_ppt_live_private_prompt(&serde_json::json!({
            "operation": "auto",
            "style": {
                "stylePreset": "dark-neon",
                "fontFamily": "sans",
                "density": "compact",
                "colorMode": "dark",
                "palette": { "background": "#0a0a0a", "ink": "#e5e5e5" }
            }
        }));

        assert!(prompt.contains("references/style-presets/dark-neon.md"));
        assert!(prompt.contains("the preset wins"));
        assert!(prompt.contains("does not suspend the ppt-design core rules"));
        assert!(prompt.contains("#0a0a0a"));
    }

    #[test]
    fn prompt_without_style_preset_has_no_style_reference_route() {
        let prompt = build_ppt_live_private_prompt(&serde_json::json!({
            "operation": "auto",
            "style": { "fontFamily": "sans", "density": "standard", "colorMode": "light" }
        }));

        assert!(!prompt.contains("references/style-presets/"));
    }

    #[test]
    fn plan_phase_prompt_requests_briefs_without_html() {
        let prompt = build_ppt_live_private_prompt(&serde_json::json!({
            "operation": "auto",
            "phase": "plan",
            "brief": { "topic": "quarterly report" }
        }));

        assert!(prompt.contains("PLANNING phase"));
        assert!(prompt.contains("\"slidePlans\""));
        assert!(prompt.contains("contentBrief"));
        assert!(prompt.contains("Do NOT generate any slide HTML"));
        assert!(prompt.contains("Skill('ppt-design')"));
        // No full-deck JSON contract or patch protocol in the plan phase.
        assert!(!prompt.contains("\"deckPatch\""));
    }

    #[test]
    fn slides_phase_prompt_renders_assigned_slides_only() {
        let prompt = build_ppt_live_private_prompt(&serde_json::json!({
            "operation": "auto",
            "phase": "slides",
            "plan": { "title": "Deck", "design": { "theme": "light" } },
            "assignedSlides": [
                { "slideNumber": 3, "title": "Risks" },
                { "slideNumber": 4, "title": "Plan" }
            ]
        }));

        assert!(prompt.contains("RENDER phase"));
        assert!(prompt.contains("slide numbers: 3, 4"));
        assert!(prompt.contains("Do NOT re-research"));
        assert!(prompt.contains("never regenerate them"));
        assert!(prompt.contains("Skill('ppt-design')"));
    }

    #[test]
    fn slides_phase_prompt_keeps_style_appendix() {
        let prompt = build_ppt_live_private_prompt(&serde_json::json!({
            "operation": "auto",
            "phase": "slides",
            "plan": {},
            "assignedSlides": [{ "slideNumber": 1 }],
            "style": { "stylePreset": "dark-neon", "colorMode": "dark" }
        }));

        assert!(prompt.contains("references/style-presets/dark-neon.md"));
        assert!(prompt.contains("Hard layout rules"));
    }

    #[test]
    fn prompt_with_current_deck_enables_incremental_patch_protocol() {
        let prompt = build_ppt_live_private_prompt(&serde_json::json!({
            "operation": "auto",
            "instruction": "Make page 2 more executive",
            "currentDeck": {
                "slides": [
                    { "slideIndex": 0, "slideNumber": 1, "id": "s1", "title": "Cover" },
                    { "slideIndex": 1, "slideNumber": 2, "id": "s2", "title": "Plan" }
                ]
            }
        }));

        assert!(prompt.contains("`currentDeck` is provided"));
        assert!(prompt.contains("\"deckPatch\""));
    }
}
