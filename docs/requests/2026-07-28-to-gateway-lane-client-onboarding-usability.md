# To the Gateway lane — client onboarding is the announcement's weakest surface

From `narnia`, 2026-07-28. Not a request for code. It is a report from trying to
onboard one real colleague on one real Mac today, and it is announcement-relevant
because the flow does not match what an announcement implies.

Everything below is `cealctl`, the access registry, and enrollment — your
surfaces. This lane owns only the worker `ceal` and cannot fix any of it. Line
references are read from the frozen `packages/ceal-operator-cli` copy in
`ceal-cli`; verify against your own source before acting on them.

## What happened

The operator installed `ceal-v0.68.0` on a Mac — clean, `darwin-arm64`, six
cosign verifications. Then, to issue the enrollment code, they went to the
Gateway host and ran `cealctl access show`, and got:

```
No current cealctl profile has a stored login session.
```

The reasonable expectation was that `narnia` already existed and would serve.
It does not, and the reason is a boundary that is correct but invisible:
`client:narnia` is a **worker client device** living in `~/.ceal`, while
`cealctl` needs an **operator session** created by `cealctl login` — a different
credential world entirely. Nothing in the message says that. It states a fact
about `cealctl` to someone holding a working `ceal` session, and the two look
like the same product.

Two smaller observations from the same attempt:

- The `cealctl` installed on the Gateway host was **not current**, so the
  operator ran it from a source path in the checkout instead. That is the same
  substitution class the worker lane refuses by design, reached here because
  the installed surface was stale rather than because anyone wanted it.
- `cealctl login`'s recovery line says to run it "on the Gateway admin host as
  its service-owning Unix account". That is a real constraint an operator has to
  discover from `--help` rather than from the failure they actually hit.

## The shape, once you know it

To onboard one colleague on one device:

1. operator: `cealctl login <admin-url>` on the admin host, as the service account
2. operator: `cealctl access apply --stdin` — declare the new device
3. operator: `cealctl enrollments create --client --profile --subject --instance`
4. operator → colleague: transfer a plaintext one-time code **privately**
5. colleague: install, `ceal session enroll`, paste the code

## Where it stops being intuitive

The operator's own words were that they simply wanted to take a colleague's
**email address** and register them. That maps onto none of it:

- **There is no email anywhere in the flow.** The four arguments are client,
  profile, subject, instance. A person's identity is `subject`, and it must
  already be bound by the Gateway. So the intuitive unit of onboarding — a
  person — is a precondition rather than an input.
- **Adding one device is a whole-registry replacement.** `cealctl access apply`
  takes `--stdin` and the recovery line says to "validate a complete replacement
  before applying it". Routine onboarding therefore carries the blast radius of
  re-declaring every membership, device, and grant. There is no incremental add.
- **The argument grammar contradicts every other surface.** `enrollments create`
  takes bare names matching `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/` — no colons —
  and prefixes them itself (`profile:${parsed.profile}`). Every other output an
  operator has looked at that day shows `profile:work`, `client:narnia`,
  `instance:ceal-prod`. Pasting what you just read fails. This lane had to read
  the source to be sure which form was correct, and told the operator so.
- **Each onboarding is a private out-of-band handoff.** The code is one-time,
  expiring, and printed in plaintext with the command's own warning not to put
  it in logs, tickets, or chat. N colleagues is N private transfers, and the
  design resists automating that on purpose.
- **It is per device.** One colleague with a laptop and a desktop is two of the
  above, including two registry applies.

None of these is a defect against its own contract. Each is a deliberate control.
The problem is the aggregate: the sum reads as an administered provisioning
system, and the announcement will be read as "install it and go".

## Why this blocks a clean announcement, not just comfort

If the first announcement's audience is larger than the set of people the
operator will personally walk through five steps, the announcement is writing a
cheque the onboarding path cannot cash. Two honest options:

- **Bound the audience.** Announce to a named list the operator will hand-hold,
  and say so in the wording.
- **Add a self-serve seam first**, and announce after.

This lane has no opinion on which, but the announcement text has to match
whichever you pick. It cannot say "install and enroll" while step 2 is a
whole-registry replacement performed by someone else.

## Directions, entirely your call

- an invite keyed on a person (email or existing identity) that returns one
  code or link, creating the device record implicitly on first enrollment, so
  the operator's unit of work is a person rather than a device
- incremental `access` mutation for adding a device, keeping whole-registry
  replacement for the cases that genuinely need review
- accept `type:name` refs wherever bare names are accepted, so an operator can
  paste what every other surface showed them
- make the missing-operator-session failure name the boundary: that a worker
  `ceal` session is not a `cealctl` operator session, and that `cealctl login`
  is the fix

## What this lane will do meanwhile

Nothing here is blocked on it. The Mac install is done and its evidence run
resumes as soon as an enrollment code exists. `ceal-v0.68.0` already removed the
checkout requirement from the colleague's side — install, enroll, then
`ceal acceptance emit --request-ref <ref>` returns the record with no repository
and no `node`. The enrollment code is now the only out-of-band step left on that
side, which is exactly why it is worth looking at.

## Not claimed

No Gateway apply, restart, registry change, enrollment, or configuration change
by this lane. The Mac has an installed signed release and no session; it has
reached no Gateway and no provider. Still no Mac evidence, so the first
announcement's supported-platform wording must still exclude Mac.
