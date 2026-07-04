---
name: product-app-runtime-component
description: Product App Runtime Component development guidance. Use when creating, editing, reviewing, or validating an app-private Runtime Component, including special Product App hosting requirements, source/runtime.json, execution host boundaries, runtime definition changes, and runtime validation evidence.
---

# Product App Runtime Component Skill

Use this skill only when the Product App needs special execution or hosting behavior beyond the default Product App runtime host. A Runtime Component describes app-private runtime requirements; the runtime instance is the actual running app after launch.

## Development Boundary

- Start from the current package facts and generated Runtime scaffold. If the runtime component is missing, create it with `CreateProductAppComponent` using kind `runtime`.
- Edit `source/runtime.json` and related generated docs/source only for special host requirements that the default Product App runtime host does not cover.
- Keep ordinary UI, AI behavior, integration actions, and structured callable tools in Surface, Agent, Bridge, or Tool Components instead.
- Do not introduce a Runtime Component just to describe normal launch policy, permissions, or package metadata.

## Runtime Vs Runtime Component

- Runtime is the platform execution environment and actual running instance of a Product App.
- A Runtime Component is an app-private package component that declares or implements special runtime host requirements for that Product App.
- The Runtime Component may depend on platform runtime capabilities, but it is not the runtime itself.

## Validation

- Refresh the Product App lock after package or component graph changes.
- Run Product App package validation.
- Verify that the Product App still launches with the declared runtime definition.
- Report any unobserved runtime behavior clearly; package validation alone is not enough for runtime changes.
