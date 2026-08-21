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

The reviewed signature block records the certificate workflow SHA, and it must
equal the candidate lock's Gateway commit. That makes the certificate binding
recoverable from the reviewed lock instead of relying on a maintainer's memory
of the Cosign invocation. Remote tag resolution is bounded and accepts either a
lightweight tag or the peeled commit of an annotated tag; a tag-object identity
is never recorded as the producer commit.

The repo-owned bootstrap is:

```sh
npm run bootstrap:gateway-handoff -- --tag gateway-protocol-handoff-v<version>
```

It writes nothing below this repository. On success it retains the verified
four-asset download in a private OS-temporary directory and emits both its
absolute archive path and the mechanically derived candidate lock as JSON.
Use that archive for the input slice and apply that lock value exactly; a local
Gateway checkout is not a substitute.

With that candidate verified, update `gateway-protocol-handoff-lock.json`, the
archive under `vendor/ceal-protocol/`, the two package manifests that name it as
a `file:` dependency, the `package-lock.json` entries carrying that file's
`integrity`, the private control-session contract, generated source, and workflow
handoff literals together. There is no vendored
tree to re-sync and no pin file to restamp: `npm run lint:protocol-artifact`
hashes the archive against the lock, so the slice is coherent exactly when those
two agree.

Then bump the three manifests — `package.json`, `packages/ceal-client`, and
`packages/ceal-worker-cli` including its exact `@corca-ai/ceal` pin — and
regenerate `package-lock.json` with `node_modules` absent. Keep that release
version change in its own commit after the handoff-input commit. Nothing else
carries the version: source reads it from its own manifest, and `repo-gates`
fails a commit that retypes it or lets the manifests disagree. `npm run check`
does not gate the lockfile, but the tagged workflow's
`npm ci --ignore-scripts` does.

The canonical guide release input is the complete `skills/ceal-guide/`
directory. Builders encode it as deterministic `ceal-guide.tar` and embed those
bytes in each signed native binary. The binary validates member paths, types,
and modes before an explicit `ceal guide register codex|claude` materializes a
content-addressed local directory. Binary installation and update never perform
that materialization or host registration.

The published inventory also retains
`scripts/assets/ceal-guide-compatibility-SKILL.md` under the historical
`ceal-guide-SKILL.md` asset name. It is a self-contained bridge, not a second
canonical guide: its only purpose is to let the immutable `ceal-v0.76.1`
installer consume the new release inventory. The exact tagged installer must
cross directly in the release test. The old binary owns the first-hop YAML and
cannot print the new guide advisory; after the update, run `ceal guide status`
and the appropriate register command. New-to-new update YAML reports
`registration_not_attempted` and the same next action.

If that first register reports an earlier Ceal-managed link, follow its exact
cleanup path, remove only that named link, and retry the same register command.
Do not reinstall the binary: the preserved link is a registration conflict, not
an update failure.

Then:

```sh
npm ci → npm run check → commit the version slice → push main
→ confirm origin/main is that commit and its check.yml run is green
→ dry-run the release lane → tag → watch
→ ceal update → binary readback → ceal guide status/register → guide readback
```

Before the first `ceal update` that crosses from a release using the legacy
mkdir-then-owner-write lock to one using atomic candidate publication, confirm
that no other legacy `ceal` command is still running on that host. A process
already paused inside the legacy owner write cannot participate in the new
generation handoff; the new lock prevents this ambiguity between current
binaries but cannot retroactively change an open file descriptor held by an old
one. Later current-to-current updates need no lock migration step.

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

## Stable rollback

To move the stable pointer back to a previously published, known-good worker
tag, run the rollback workflow with the literal confirmation:

```sh
gh workflow run ceal-worker-stable-rollback.yml --ref main \
  -f tag=ceal-v<known-good-version> \
  -f confirmation=ROLLBACK
```

The workflow re-verifies the selected immutable tag's signed inventory, then
binds the verified bootstrap and pointer to the same rollback run before the
release-origin update. No per-release environment variable entry is part of
rollback. After the run, read the public pointer back and confirm its tag:

```sh
curl --fail --silent --show-error \
  https://ceal.borca.ai/releases/worker/stable/ceal-worker-stable-release.json
```

## Employee verified-email device adoption

For a consenting employee device, the preferred flow is verified-email
adoption. It does not copy an operator-visible enrollment code through chat or
email. The employee supplies the published Gateway URL and the mailbox that
received the invitation:

```sh
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

A session also belongs to one adopted host. Never copy its stored access or
one-time refresh credential to another machine: replay detection deliberately
revokes that session family. Run adoption or enrollment independently on each
host so renewal, revocation, and audit stay host-attributable.

Ask the Gateway owner to issue the worker enrollment code through its canonical
operator procedure. This repository neither owns nor documents `cealctl`,
Gateway-host paths, host names, subjects, or operator sessions. Then locally:

```sh
ceal session enroll --gateway <https-url> --code-stdin
```

Add `--force` only when this host already holds a session for another identity
and that binding is genuinely finished with; the command names what would change
before you decide.

A web-shell activation code is not this code: `ceal-ops admin-api invite` can
never carry `ceal.client.enroll`.
