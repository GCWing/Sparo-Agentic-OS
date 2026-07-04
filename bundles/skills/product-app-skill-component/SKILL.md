---
name: product-app-skill-component
description: Product App Skill Component development guidance. Use when creating, editing, reviewing, or validating an app-private Skill Component, including app-specific workflow knowledge, source/SKILL.md, reusable guidance for the app's agent or authoring flow, examples, and validation evidence.
---

# Product App Skill Component Skill

Use this skill when the Product App needs app-specific reusable workflow knowledge. A Skill Component packages guidance for this Product App's behavior or authoring flow; it is not the system prompt, not UI code, and not a shared skill package.

## Development Boundary

- Start from the current package facts and generated Skill scaffold. If the skill component is missing, create it with `CreateProductAppComponent` using kind `skill`.
- Edit `source/SKILL.md` for app-specific workflows, constraints, examples, and decision rules.
- Keep Product App API details in implementation code or `product-app-api`, and keep visual design guidance in `product-app-ui-polish`.
- Keep the guidance narrow enough that the app's Agent or authoring flow can apply it consistently.

## Key Decisions

- Use a Skill Component for reusable product/domain procedure, not for one-off notes or package metadata.
- Include examples only when they reduce ambiguity for future app behavior.
- Update the skill when the app's actual workflow changes, so it stays aligned with package behavior and eval fixtures.
- If the skill guides an Agent Component, align it with that agent's `source/prompt.md` and fixtures.

## Validation

- Refresh the Product App lock after package or component graph changes.
- Run Product App package validation.
- If the skill affects agent behavior, run Agent Eval or report that eval evidence is missing.
- If the skill affects authoring behavior only, validate package wiring and state which downstream behavior still needs runtime evidence.
