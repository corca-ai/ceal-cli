# Gateway lane handoff — immutable `0.66.1` signed packet

From: `vinc` Gateway lane, 2026-07-27

## Accepted Gateway release tuple

- Tag: `gateway-handoff-v0.66.1`
  - annotated tag object: `c5a44c3fbf7babf165339e7180f36dfb353ed883`
  - immutable peeled commit: `2747f6b17a115a3fce0cf2da1527461e07a851de`
  - producer tree: `b6728f2a8513af493a1348aae456c09357617898`
- GitHub Actions run: https://github.com/corca-ai/ceal/actions/runs/30311215898
  - `create-and-sign`: passed
  - independent workflow `readback`: passed
- Artifact name: `ceal-gateway-handoff-2747f6b17a115a3fce0cf2da1527461e07a851de`
- Archive: `ceal-gateway-handoff-0.66.1.tar.gz`
  - SHA-256: `493b8e8dc0ea84b6d0f84df5f67b7645096da3a8682106c525b9c605f28e1dfa`
  - signature SHA-256: `0836c8ea57a93e22d0947455a34f357af8cbf2bd77f8c49aae2825a716d068f6`
  - certificate SHA-256: `28bca1a1a0e99bc4c4476d58f0022d992244f25cd85c8f33e3d63f4aeecff8bd`
- Package pair:
  - `@corca-ai/ceal-protocol@0.66.1` — tarball SHA-256 `3f92a942b12484b02cd9d7892a38cb9472ac5d3b4088fce1fd1f793e1e85d0ab`
  - `@corca-ai/ceal@0.66.1` — tarball SHA-256 `7dca358dc11e0f86232cc76643c6b0d439c6db5b37c0d59a46d5e184687ebb24`

## Independent readback on `vinc`

The downloaded artifact passed `sha256sum --check`. `cosign verify-blob` passed
with the GitHub OIDC issuer and this exact certificate identity:

`https://github.com/corca-ai/ceal/.github/workflows/gateway-handoff-archive.yml@refs/tags/gateway-handoff-v0.66.1`

The archive has exactly these six members:

- `.ceal-handoff-owner`
- `corca-ai-ceal-protocol-0.66.1.tgz`
- `corca-ai-ceal-0.66.1.tgz`
- `gateway-artifact-handoff.json`
- `gateway-conformance-proof.json`
- `gateway-protocol-provenance.json`

Its manifest binds `corca-ai/ceal`, producer commit
`2747f6b17a115a3fce0cf2da1527461e07a851de`, and the two `0.66.1` packages.

## Narnia next action

Use only this digest-and-commit-pinned packet for the ceal-cli acceptance path,
then produce fresh Mac and Linux install/handshake evidence. Do not treat the
Gateway artifact as ceal-cli acceptance, provider live proof, or announcement
authorization by itself.
