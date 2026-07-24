# Troubleshooting

Common gates:
- No HDC target: install, launch, screenshot, hierarchy, and hilog are blocked.
- Emulator listed but not online: start public emulator and wait for HDC target.
- Beta/non-public emulator: do not default to it.
- HVigor failure: read the redacted build diagnostic and relevant source/config.
- Launch failure: verify bundleName, ability name, module config, install result, and `aa start` output.
- Screenshot or hierarchy failure: report the exact missing probe and continue with available evidence.
