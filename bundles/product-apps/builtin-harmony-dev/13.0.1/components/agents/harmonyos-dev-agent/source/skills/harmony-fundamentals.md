# HarmonyOS Fundamentals

Key files:
- `build-profile.json5`: products, runtimeOS, target SDK, modules, build modes, signing references.
- `AppScope/app.json5`: bundle name, app label, icon, version.
- `entry/src/main/module.json5`: module name, main ability, device types, permissions, pages, ability entries.
- `entry/src/main/ets`: ArkTS abilities, pages, components, services, and models.
- `entry/src/main/resources`: strings, colors, media, profiles, and page lists.

Detection rules:
- Confirm `runtimeOS` is `HarmonyOS`.
- Read bundle/module/ability metadata before editing.
- Treat signing material as sensitive. Only report whether signing is configured and whether referenced files appear present.
