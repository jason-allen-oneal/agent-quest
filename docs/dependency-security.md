# October 2026 dependency security update

The locked production dependencies pass `npm audit --omit=dev` after updating
Next.js to 16.4.2 and React to 19.2.8. Use patched Node 22.23.4, 24.22.1, or a
newer supported release satisfying the package engine range.

## Prisma config merger

Prisma remains on 6.19.3; no database schema, authentication, or Prisma 7 migration
is included. The override is scoped to `@prisma/config` → `deepmerge-ts@8.0.2`,
fixing recursive-object stack exhaustion
([GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)).
Prisma uses this merger for configuration records. Version 8 changes Map merging
semantics and types; these are not used by the application config. Regression
tests exercise nested plain records, recursive record pairs, and Prisma's actual
config loader. Prisma client generation, validation and the app build also run
in CI. Remove the override when the selected Prisma release requires a fixed
merger itself; do not remove it merely to reduce lockfile churn.

## Development-only upstream finding

The full audit still reports five package-chain entries from `braces@3.0.3`
through Next's ESLint plugin, fast-glob and micromatch. The underlying
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) has no
published fixed release as of October 21, 2026. The production tree is clean.
Lint rules remain enabled; no advisory is ignored. Do not accept npm audit's
suggested Next 14 lint-preset downgrade for this Next 16 application.
