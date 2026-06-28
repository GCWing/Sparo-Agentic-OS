# Signing And Permissions

Never reveal:
- signing passwords
- store passwords
- private keys
- certificate secret material
- token-like values

Safe to report:
- signing configured: true/false
- material paths present: true/false
- profile/certificate missing at a high level
- permission names and ability usage from module config

If signing blocks install, ask the user to refresh local DevEco signing material or choose unsigned build validation when appropriate.
