---
name: product-app-tool-component
description: Product App Tool Component development guidance. Use when creating, editing, reviewing, or validating an app-private Tool Component, including source/tool.schema.json, source/tool.js, structured tool contracts, app or agent calls, deterministic outputs, and capability evidence.
---

# Product App Tool Component Skill

Use this skill when the Product App needs a structured callable capability that can be invoked by the app or its app-private Agent. A Tool Component is an app-private tool contract for one Product App unless the user explicitly asks for a reusable shared capability outside App Studio's default delivery boundary.

## Development Boundary

- Start from the current package facts and generated Tool scaffold. If the tool is missing, create it with `CreateProductAppComponent` using kind `tool`.
- Define the contract in `source/tool.schema.json`: name, description, input schema, and output schema.
- Implement behavior in `source/tool.js`, keeping outputs structured and stable.
- Keep visible UI rendering in app-private surfaces and broad integration/service-action boundaries in Bridge Components.
- Keep permissions limited to the tool's declared behavior and callers.

## Key Decisions

- Use a Tool Component when callers need a typed function-like capability, not when they need a visible screen or a long-running integration boundary.
- Design schemas from caller needs: required fields, result shape, error shape, and deterministic examples.
- Keep side effects explicit. If the tool writes files, runs shell commands, or calls network services, that must be reflected in permissions and validation.
- Use `product-app-api` when wiring the tool to Product App backend calls, permissions, or runtime evidence.

## Validation

- Refresh the Product App lock after package or component graph changes.
- Run Product App package validation.
- Execute a capability preview or concrete fixture when allowed.
- If execution is not allowed or no fixture exists, validate the contract and report that behavior execution remains unverified.
