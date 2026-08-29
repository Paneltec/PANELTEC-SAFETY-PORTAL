# Paneltec Civil — Frontend

## Standalone audit ESLint configs

Two flat-config ESLint files live in this directory alongside the
default CRA-wired config. They are **not** part of the production
build (CRA's react-scripts owns that lifecycle). They exist so we
can run focused, reproducible audits from the pod without touching
the app entrypoint.

### `eslint.audit.config.mjs`
General audit — `no-undef` + `react/jsx-uses-vars`. Introduced in
v58.13.64b to sanity-check the "58 undefined variables" reviewer
claim. Confirms zero real undefined-name sites in the frontend
when standard `browser + node + jest` globals are configured.

Usage:
```
node_modules/.bin/eslint --config eslint.audit.config.mjs src --format json
```

### `eslint.hooks.audit.mjs`
Hooks-only audit — `react-hooks/exhaustive-deps` + `react-hooks/rules-of-hooks`.
Introduced in v58.13.66 for the multi-ship hook-deps cleanup
(66/67/68/69 chain). Each ship uses this config to enumerate,
categorize, and freeze fixes for its target subset.

Usage:
```
node_modules/.bin/eslint --config eslint.hooks.audit.mjs src --format json
```

Both configs whitelist the same set of runtime globals (browser +
node + jest + `process` readonly) so their output isn't polluted
by CRA's implicit-global sugar.
