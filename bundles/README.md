# Bundles

This directory contains bundled product content that is shipped with Sparo OS but
is not part of the core runtime implementation.

- `live-apps/`: built-in Live App source packages embedded and seeded by
  `src/crates/core/src/live_app/builtin/mod.rs`. Each package must include a
  `bundle.json` with `schemaVersion`, stable `id`, and reseed `version`.
- `skills/`: built-in skills embedded by the skill registry and synchronized to
  the Sparo OS managed skills location.
- `playbooks/`: built-in Playbook YAML files embedded by the Playbook tool.
- `bridge-apps/`: built-in Bridge App packages. Keep concrete Bridge App
  adapters here instead of under `src/crates/core/src/bridge_app`.

Runtime code belongs under `src/`; bundled content belongs here.
