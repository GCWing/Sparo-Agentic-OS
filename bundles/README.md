# Bundles

This directory contains bundled product content that is shipped with Sparo OS but
is not part of the core runtime implementation.

- `surface-components/`: built-in Surface Component source packages embedded and seeded by
  `src/crates/core/src/surface_component/builtin/mod.rs`. Each package must include a
  `bundle.json` with `schemaVersion`, stable `id`, and bundle `version`.
  Installed built-ins are refreshed when either the bundle version or package
  source digest changes, so development builds do not keep serving stale
  runtime copies after source edits.
- `skills/`: built-in skills embedded by the skill registry and synchronized to
  the Sparo OS managed skills location.
- `playbooks/`: built-in Playbook YAML files embedded by the Playbook tool.
- `bridge-components/`: built-in Bridge Component packages. Keep concrete Bridge Component
  adapters here instead of under `src/crates/core/src/bridge_component`. Installed
  built-in Bridge Components use the same bundle version plus source digest refresh
  model as built-in Surface Components.

Runtime code belongs under `src/`; bundled content belongs here.
