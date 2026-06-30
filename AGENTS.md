# AGENTS.md

Source-of-truth guidance for agents (and humans) working in `xmemory-npm`, the
TypeScript/JavaScript client library for the xmemory API.

## Version bump on every user-facing change

**Whenever you ship a user-facing change, bump the version in the same change
set.** This is mandatory — the package is published to npm, so an un-bumped
version means the change cannot be released and the changelog drifts from what
is actually shipped.

A change is user-facing if it adds a method, adds or changes an option,
changes behavior, or fixes a bug.

In the same change set you must:

1. Bump `version` in `package.json` following [semver](https://semver.org/):
   - **patch** (`x.y.Z`) — bug fixes, no API change.
   - **minor** (`x.Y.0`) — additive features (new method, new option), existing
     callers unaffected.
   - **major** (`X.0.0`) — breaking changes.
2. Sync `package-lock.json` to the new version — run `npm install
   --package-lock-only` (updates the two `version` fields without touching
   dependencies).
3. Add a matching section to `CHANGELOG.md` under a new heading for that version,
   describing what changed.
4. Keep these in sync: `package.json` version, `package-lock.json`, the top
   `CHANGELOG.md` heading, and (at release time) the `git tag` (`vX.Y.Z`).

Purely internal changes (tests, comments, refactors with no observable effect)
do not require a bump.

## Build, test, and release

```bash
npm run build       # tsc -> dist/
npm run test        # type-check + run test.ts
npm run test:types  # type-check only (tsc --noEmit)
```

- `dist/` is the published output; `prepublishOnly` runs the build automatically.
- The package entry points are `dist/index.js` (`main`) and `dist/index.d.ts`
  (`types`); only `dist` is published (see `files` in `package.json`).

## Layout

- `src/` — library source (`index.ts` re-exports the public surface;
  `instance.ts`, `types.ts`, etc.).
- `examples/` — runnable end-to-end examples; keep them working when the API
  surface changes.
- `README.md` — public documentation. Update it alongside any change to the
  public API surface.
