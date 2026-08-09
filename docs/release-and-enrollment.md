# Release And Re-enrollment Procedures

Both are standing procedures rather than session state, so they live here rather
than in a baton that would restate them every session. `AGENTS.md` carries only
the approval rule that governs them.

Both also assume access a successor may not have.
[docs/operator-acceptance.md](operator-acceptance.md) says which access each step
needs and how to check for it before a tag is spent, since a burned tag is the
expensive way to discover the answer.

## Release

Before a worker release, consume a signed Gateway Protocol handoff as one
committed input slice. The Gateway publishes no GitHub Release: the public
producer surface is
`https://ceal.borca.ai/releases/gateway-protocol-handoff/<tag>/`, containing
exactly the versioned archive, its `.sig`, its `.pem`, and `SHA256SUMS`.
Existence is not verification. Before changing this repository, a read-only
bootstrap must download all four into a temporary directory, check the sums,
verify the blob with Cosign against repository `corca-ai/ceal`, the exact tag,
workflow `.github/workflows/gateway-protocol-handoff-release.yml`, and the
GitHub Actions OIDC issuer, and bind the manifest's producer commit to the
remote tag and certificate workflow SHA. It must derive the candidate lock
tuple only from those verified bytes and certificate claims. If no repo-owned
command performs that bootstrap, stop rather than reconstructing it from a
Gateway checkout or hand-editing a lock from memory.

With that candidate verified, update
`gateway-protocol-handoff-lock.json`, `protocol-vendor-pin.json`, the frozen
`packages/ceal-protocol` tree, the private control-session contract, generated
source, and workflow handoff literals together. The vendor-pin check reads the
committed frozen tree by design, so run it after committing that coherent slice;
never weaken it to accept a transient worktree copy.

Then bump the three manifests — `package.json`, `packages/ceal-client`, and
`packages/ceal-worker-cli` including its exact `@corca-ai/ceal` pin — and
regenerate `package-lock.json` with `node_modules` absent. Keep that release
version change in its own commit after the handoff-input commit. Nothing else
carries the version: source reads it from its own manifest, and `repo-gates`
fails a commit that retypes it or lets the manifests disagree. `npm run check`
does not gate the lockfile, but the tagged workflow's
`npm ci --ignore-scripts` does.

Then:

```
npm ci → npm run check → commit the version slice → push main
→ confirm origin/main is that commit and its check.yml run is green
→ dry-run the release lane → tag → watch
→ ceal update → readback
```

**The dry run is a step, not an option, whenever the release lane itself
changed.** `gh workflow run ceal-release.yml --ref main` builds, composes and
merges exactly what a tag would and then stops: `sign-and-publish` is the one
job gated on the push event, so a dispatch reaches neither the signing identity
nor the origin credentials. Read the run before tagging —
`gh run list --workflow=ceal-release.yml`.

It exists because **a burned tag is never reused**, and without it the first
execution of any change to that workflow is a real release. That is not
hypothetical: `ceal-v0.67.0` burned on a flag that had landed one release
earlier, and no `check.yml` leg is arm64, so nothing else could have caught it.

`CHANGELOG.md` owns which tags are burned and why.

## Employee verified-email device adoption

For a consenting employee device, the preferred flow is verified-email
adoption. It does not copy an operator-visible enrollment code through chat or
email. The employee supplies the published Gateway URL and the mailbox that
received the invitation:

```
ceal session adopt --gateway <https-url> --email <employee-email>
```

The command generates device keys locally, shows the employee the two
fingerprints to compare in their browser, and waits only for the Gateway's
bounded poll interval. The browser verifies the mailbox; the Gateway seals the
resulting session to the device key; the command stores it only after it
validates the Gateway origin, transaction, both keys, authenticated delivery,
and session payload binding.

This is a client contract, not proof that a particular Gateway instance has
enabled the routes, configured its mail sender, delivered an invitation, or
accepted a device. Additional-device approval behavior is a paired
Gateway/Protocol/client release concern and must not be promised by this
procedure until that exact signed client version is installed. Do not advertise
the flow as available until the Gateway has been applied and a consenting named
device has produced the required acceptance evidence.

## Additional device and recovery enrollment

A worker session binds one instance, so switching is locally destructive. Do this
only when the current binding is genuinely finished with. The client enforces
that now: an enrollment or adoption naming a different identity is refused with
the changed bindings listed, and only `--force` replaces one — revoking the
displaced session and clearing the local state it produced. Re-enrolling the
same identity, which is what an unrenewable session needs, takes no flag.

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
ceal session enroll --gateway <https-url> --code-stdin
```

Add `--force` only when this host already holds a session for another identity
and that binding is genuinely finished with; the command names what would change
before you decide.

A web-shell activation code is not this code: `ceal-ops admin-api invite` can
never carry `ceal.client.enroll`.
