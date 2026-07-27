# Release And Re-enrollment Procedures

Both are standing procedures rather than session state, so they live here rather
than in a baton that would restate them every session. `AGENTS.md` carries only
the approval rule that governs them.

## Release

Bump the three manifests — `package.json`, `packages/ceal-client`, and
`packages/ceal-worker-cli` including its exact `@corca-ai/ceal` pin — then
`npm i` to regenerate `package-lock.json`. `npm run check` does not gate the
lockfile, but the tagged workflow's `npm ci --ignore-scripts` does.

Nothing else carries the version. Source reads it from its own manifest, and
`repo-gates` fails a commit that retypes it or lets the manifests disagree.

Then:

```
npm ci → npm run check → commit → push main
→ confirm origin/main is that commit → tag → watch
→ ceal update → readback
```

`CHANGELOG.md` owns which tags are burned and why. A burned tag is never reused.

## Re-enrollment

A worker session binds one instance, so switching is locally destructive. Do this
only when the current binding is genuinely finished with.

On the Gateway host (`ssh oc`), use the owner copy at
`~/ceal/packages/ceal-operator-cli`. The installed `cealctl 0.65.3` there is the
other lineage and has no `enrollments` route.

```
cealctl login <admin-origin> --session <name>
cealctl enrollments create --client narnia --profile work --subject hwidong \
  --instance <name> --operator-session <name>
```

Then locally:

```
ceal session enroll --code-stdin
```

A web-shell activation code is not this code: `ceal-ops admin-api invite` can
never carry `ceal.client.enroll`.
