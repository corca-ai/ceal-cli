import packageJson from "../package.json" with { type: "json" };

/**
 * This package's published version, read from the manifest that defines it.
 *
 * It used to be a string literal typed inline into two request bodies, so a
 * release that bumped `package.json` and missed one of them would introduce
 * itself to the Gateway under a version it is not — silently, since nothing
 * reads these values back. npm owns the version in `package.json`, so that is
 * the only place it is written.
 *
 * `tsc` keeps the specifier relative to the emitted file, and both `src` and
 * `dist` sit one level below the package root, so it resolves to the same
 * manifest before and after the build, and inside the published tarball. The
 * worker binary bundles this package with esbuild, which inlines the JSON at
 * bundle time — nothing reads a file at runtime, so the single-executable
 * build is unaffected.
 */
export const CEAL_CLIENT_VERSION: string = packageJson.version;
