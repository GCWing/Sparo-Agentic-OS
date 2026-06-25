# Build Install Verify

Default verification loop:
1. Detect project and toolchain.
2. Build with HVigor.
3. If an HDC target is online, install the latest artifact.
4. Launch the detected bundle and ability.
5. Capture screenshot and UI hierarchy when probes are available.
6. Summarize evidence and gaps.

If no target is online, report build evidence and the blocked device gate explicitly.
Do not treat Hot Reload as proof; use it only as an optional acceleration path.
