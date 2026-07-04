# Bundles

This directory contains bundled product content that is shipped with Sparo OS but
is not part of the core runtime implementation.

- `product-apps/builtin/`: built-in Product App packages. Each app owns one
  top-level directory, with versioned packages below it. Product App private
  Surface source lives under each package's
  `components/surfaces/<surface-id>/source/` directory and is locked with the
  Product App package. App-private Agent and Bridge implementations live beside
  their app-owned component metadata under
  `components/agents/<agent-id>/source/` and
  `components/bridges/<bridge-id>/source/`.
- `components/`: shared Component packages referenced by Product Apps. Use this
  only for independently versioned components that are intentionally reusable
  across apps.
- `agent-components/`: truly shared built-in Agent Component implementation
  bundles. Product App-specific agents belong under their owning Product App
  package, not here.
- `skills/`: built-in skills embedded by the skill registry and synchronized to
  the Sparo OS managed skills location.
- `playbooks/`: built-in Playbook YAML files embedded by the Playbook tool.
- `bridge-components/`: truly shared built-in Bridge Component implementation
  adapters referenced by shared Component packages or runtime/eval tools. Product
  App-specific runtimes belong under their owning Product App package.
  Keep concrete shared adapters here instead of under
  `src/crates/core/src/bridge_component`.
  Installed built-ins use the same bundle version plus source digest refresh
  model as built-in Product App runtime dependencies.

Runtime code belongs under `src/`; bundled content belongs here.
