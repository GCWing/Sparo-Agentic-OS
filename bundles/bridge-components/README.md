# Bridge Components

Truly shared built-in Bridge Component packages belong here. Product App-specific
runtime bridges belong inside their owning Product App package at:

```text
bundles/product-apps/<app-id>/<version>/components/bridges/<component-id>/source/
```

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
execution machinery. Concrete shared external integrations should live in this bundle
root.
