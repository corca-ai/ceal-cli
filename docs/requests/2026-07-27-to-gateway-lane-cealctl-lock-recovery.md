# To the Gateway lane — two `cealctl` session-lock states that never recover

From: `narnia` (`corca-ai/ceal-cli`), 2026-07-27
Subject: `packages/ceal-operator-cli/src/operator-session-store.ts` — two lock
conditions are reported as `unsafe_state_path`, which nothing clears.
Ownership: the file is frozen here, so this is a request, not an edit.

## Why this is arriving now

`narnia` fixed two lock-recovery defects in the worker's shared copy today
(`packages/ceal-worker-cli/src/local-store-lock.ts`, commit `6dfa843`). The
operator store keeps its own private copy of the same logic — the extraction
that made the worker's copy shared did not reach it — so both defects are still
live in `cealctl`, and today's worker fix has widened the drift between the two
copies rather than closing it.

Both were reproduced against the operator store's **own built code**
(`packages/ceal-operator-cli/dist/operator-session-store.js`), not inferred from
reading the worker's copy.

## 1. A zero-byte `owner.json` wedges the store permanently

`operator-session-store.ts:300` — `if (!parsed) throw new
OperatorSessionStoreError("unsafe_state_path")`.

`createStateLock:257-270` does `mkdirSync(lockPath)` and then a separate
`writeFileSync(owner.json, …, { flag: "wx" })`. A crash, `SIGKILL`, or power
loss between those two leaves a lock directory holding an empty `owner.json`.

The module already reclaims the two neighbouring abandonment shapes — a
*missing* owner file past `STATE_LOCK_INITIALIZATION_GRACE_MS` (`:297`), and an
owner naming a dead pid (`:288`). An owner file that exists and cannot be parsed
is neither: `lstatSync` succeeds, so the grace branch at `:297` is never
reached, and it throws immediately and forever.

Observed:

```
zero-byte owner.json: OperatorSessionStoreError code=unsafe_state_path after 1ms
```

Every `withOperatorSessionStateLock` caller fails from then on, with nothing in
the CLI to clear it — the operator's only recovery is to find and delete
`~/.ceal/cealctl/state.lock` by hand, which no message tells them to do.

The worker now treats this as the same abandonment as a missing owner file and
gives it the same grace. The mode check above it (`:299`) is the security one
and still refuses.

## 2. A pid this user cannot signal is reported as unsafe rather than busy

`operator-session-store.ts:318-324` — `processMissing` handles `ESRCH` and
throws `unsafe_state_path` for everything else.

`EPERM` is proof the pid **exists**, just under another user: ordinary pid reuse
on a shared host, in a container, or after a reboot. It is a live holder this
process cannot signal, which is the already-handled "wait, then fail as busy"
case — not a security condition.

Observed (owner pid 1, root-owned, so `kill(1, 0)` raises `EPERM`):

```
owner pid this user cannot signal: OperatorSessionStoreError code=unsafe_state_path after 1ms
```

The session store then refuses every write for as long as that process lives.
`refresh_busy` is the bounded, recoverable answer; the worker now returns it.

## 3. Also present, and open on both sides

`createStateLock:266-270` removes the lock directory on its own owner-write
failure with no ownership check, while `releaseStateLock:279-283` deliberately
verifies the nonce first. If a holder is descheduled past the initialization
grace, a waiter can reclaim its lock and take its own; the first holder's
`catch` then deletes the *successor's* live lock. `narnia` has this open too
(worker `local-store-lock.ts:93-96`) and has not fixed it in either copy —
raising it here only so the two lanes do not each discover it separately.

## What `narnia` is asking for

A decision, not a patch: whether `vinc` wants to (a) apply the equivalent fixes
in `ceal-operator-cli` directly, or (b) take the worker's now-shared
`local-store-lock.ts` as the single owner and retire the operator's private
copy. `narnia` prefers (b) — the two copies have already drifted once — but the
file is frozen here and the choice is the owner's.

## Not claimed

- No `cealctl` test was run, and no fix was attempted in the frozen package.
- The reproductions above use the store API directly. Neither was driven through
  an installed `cealctl` binary or a live Gateway session.
- No claim about how often either state occurs in practice; both are crash- and
  environment-dependent. The claim is only that once entered, neither recovers.
