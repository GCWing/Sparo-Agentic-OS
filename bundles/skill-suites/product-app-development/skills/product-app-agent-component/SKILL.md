---
name: product-app-agent-component
description: Product App Agent Component development guidance. Use when creating, editing, reviewing, or validating an app-private Agent Component, including the app's built-in associated agent, prompt.md, fixtures.json, AI behavior, backend bindings, service actions, and Agent Eval evidence.
---

# Product App Agent Component Skill

Use this skill when the Product App needs app-private intelligence. An Agent Component is the app's built-in associated agent: it owns prompt and evaluation behavior for this app, and its capabilities must be exposed to the Product App through controlled backend bindings or service actions.

## Development Boundary

- Start from the current package facts and generated Agent scaffold. If the agent is missing, create it with `CreateProductAppComponent` using kind `agent`.
- Edit `source/prompt.md` for the agent's role, domain behavior, tool policy, response shape, and safety boundaries.
- Edit `source/fixtures.json` for app-specific eval fixtures that prove the behavior expected by the Product App.
- Keep durable app state in the Product App Work/runtime boundary. Do not use the raw Agentic authoring session as internal Product App state.
- Keep the Agent Component app-private unless the user is explicitly asking for a reusable cross-app capability, which App Builder does not author by default.

## Key Decisions

- Define what the agent does for the app, what it refuses or escalates, and which Product App state or service actions it may rely on.
- Prefer backend bindings/service actions for capabilities used by the surface. The surface should call the Product App backend boundary, not reach into an authoring conversation.
- Align AI permissions and model scope with the app's actual user promise. Do not widen permissions for speculative behavior.
- Use `product-app-api` when wiring the agent to `app.backend`, service actions, AI permissions, runtime events, or surface calls.

## Validation

- Refresh the Product App lock after package or component graph changes.
- Run Product App package validation.
- Run Agent Eval when prompt or fixture behavior changes, or report that Agent Eval evidence is missing.
- Preview the user path that invokes the agent when the app surface depends on agent output.
