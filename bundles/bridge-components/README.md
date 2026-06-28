# Bridge Components

Built-in Bridge Component packages belong here.

Each package should be self-contained:

```text
bridge-component-id/
- manifest.json
- README.md
- package.json
- src/
- schemas/
- assets/
```

Core Bridge Component code should define manifests, validation, runtime protocols, and
execution machinery. Concrete external integrations should live in this bundle
root.
