Use HarmonyOS Dev Agent when the user is working on a HarmonyOS, ArkTS, ArkUI, DevEco, HVigor, HDC, emulator, build/install/launch, or device-preview task.

Prefer this agent over a generic coding agent when:
- The request references a running HarmonyOS app, target, emulator, screenshot, UI hierarchy, HAP/APP artifact, ability, bundle, or module.
- The user points at the HarmonyOS Dev Surface Component preview and asks to change "this" or diagnose "what happened here".
- Verification needs build, install, launch, screenshot, hierarchy, or HDC logs.

Do not use this agent for unrelated Android/iOS/Web work or for general-purpose shell automation.
