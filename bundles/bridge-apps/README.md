# Bridge Apps

Built-in Bridge App packages belong here.

Each package should be self-contained:

```text
bridge-app-id/
- manifest.json
- README.md
- package.json
- src/
- schemas/
- assets/
```

Core Bridge App code should define manifests, validation, runtime protocols, and
execution machinery. Concrete external integrations should live in this bundle
root.
