---
name: product-app-bridge-component
description: Product App Bridge Component development guidance. Use when creating, editing, reviewing, or validating an app-private Bridge Component, including service action boundaries, source/actions.json, source/worker.js, backend bindings, host or external capability access, permissions, and capability preview evidence.
---

# Product App Bridge Component Skill

Use this skill when the Product App needs a controlled backend boundary to host capabilities, external systems, or service actions. A Bridge Component is app-private integration logic for one Product App, not a general connector package.

## Development Boundary

- Start from the current package facts and generated Bridge scaffold. If the bridge is missing, create it with `CreateProductAppComponent` using kind `bridge`.
- Define callable service actions in `source/actions.json`.
- Implement action behavior in `source/worker.js` or the generated bridge source files.
- Expose bridge capabilities through Product App backend bindings/service actions before UI or agent code calls them.
- Keep permissions minimal and tied to declared action behavior.

## Key Decisions

- Name actions by product intent, not by implementation detail.
- Make input and output contracts explicit enough for Surface and Agent callers to use safely.
- Return structured errors that UI and Agent logic can handle.
- Use `product-app-api` when bridge calls involve `app.backend`, permissions, runtime events, file/network/shell access, or surface wiring.

## Validation

- Refresh the Product App lock after package or component graph changes.
- Run Product App package validation.
- Run a capability preview or concrete action fixture when one exists and execution is allowed.
- If an action cannot be executed safely, validate the package/contract and report the unexecuted call as missing runtime evidence.
