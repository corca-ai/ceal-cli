# Session Handoff

## Workflow Trigger

이 파일만 언급되면 `## Current State`를 읽고, `## Debt`에서 고르거나 운영자가
지시한 작업을 시작한다. `ceal capabilities --fresh`와 `ceal call`은 실세션·provider
동작이라 승인 후에만.

## 2026-08-08 — 레거시 레인을 지웠다

두 슬라이스로 진행했다.

**1. 테스트 정리.** 판단 기준은 "이 단언이 깨지는 것이 실제 결함을 뜻하는가,
아니면 파일 둘을 손으로 못 맞춘 것을 뜻하는가"였다.

- `release-contract.json`의 guide digest 단언을 워커 게이트에서 뺐다. 이전
  핸드오프는 "릴리스가 그 값을 읽지도 않는다"고 적었는데 **틀렸다** —
  `build-platform-binaries.mjs`가 읽고 `guide_drift`로 실패했다. 다만 그건 frozen
  legacy 레인이었고, 워커 레인은 `worker-release-inputs.json`이
  `release-contract.json`을 `forbidden_release_inputs`로 못 박는다.
- `guide-contract.test.mjs`는 `worker-guide-contract.test.mjs`와 네 테스트가 통째로
  중복이었다. 레인 분리 때 갈라져 나온 사본이다.
- 워크플로 시퀀스 정규식이 `--fresh`를 리터럴로 박고 있어서, "커맨드 스냅샷 금지"를
  제목으로 단 테스트가 정작 스냅샷이었다. `cc29047`의 문서화된 결정이 그걸 깼다.
- npm 스크립트 전문 일치 → 테스트 파일 집합 + 러너 검사, `workspaces`·플랫폼 목록
  순서 고정 → 주장 자체, 중복된 태그 트리거 raw 정규식 삭제, `platformProofTest`
  사용처 이름 하드코딩 → 공허성 하한. 같은 파일 상수를 단언하던
  `WORKER_CONTRACT_TESTS.length <= 20` 테스트는 삭제했다.

**2. 레거시 레인 삭제.** `../ceal`을 직접 확인한 결과 이 리포의 cealctl 자산은
**낡은 포크**였다. `packages/ceal-operator-cli`는 소스 6개 파일이 다르고
`access-command-help.ts`·`bounded-json-response.ts`가 없었으며, cealctl 가이드는
`packages/official-skills/ceal-native/skills/cealctl-guide/SKILL.md`에서 전면
재작성돼 있었고, 설치기는 `packaging/cealctl/install-cealctl.sh`로 옮겨져 있었다.
`packaging/ceal-cli-source/`도 실제로 없다. README가 말하던 Stage 5 deletion gate에
도달한 상태였다.

지운 것: `packages/ceal-operator-cli`, `skills/cealctl-guide`, `install.sh`,
`release-contract.json`, `ceal-cli-seed-manifest.json`,
`scripts/build-platform-binaries.mjs`, `scripts/build-release-manifest.mjs`,
`.github/workflows/cealctl-release.yml`, `test:legacy-compatibility` 스위트 4개 파일,
그리고 development-only 사슬 중 죽은 절반 — `scripts/build-worker-release-artifact.mjs`,
`scripts/verify-worker-release-inputs.mjs`, `release/worker-inputs.json`과 그 테스트.

**지우지 않은 것과 그 이유:**

- `.github/workflows/npm-package-stage.yml`과 bare `v*` 태그. cealctl 자산이 아니라
  `@corca-ai/ceal-protocol`·`@corca-ai/ceal`의 유일한 npm 발행 경로다. 운영자 판단.
- `scripts/verify-gateway-protocol-consumer.mjs`. **죽은 코드가 아니다** —
  `npm run check` 안에서 `test/gateway-protocol-consumer.test.mjs`를 통해 약 16초간
  실제로 돈다. 라이브 레인이 증명하지 못하는 둘을 증명한다: 실제 npm resolver가
  `package-lock`을 Gateway tarball에 바인딩하는지(`link: true`도, 레지스트리 사본도
  아닌지)와, 설치된 소비자에서 `import.meta.resolve`가 `node_modules/` 안을 가리키는지.
  라이브 레인은 tarball을 손으로 풀기 때문에 npm resolver를 아예 안 거친다.
  대신 그 스크립트가 읽던 중복 인벤토리(`release/worker-inputs.json`)만 떼어내고
  라이브 `worker-release-inputs.json`을 직접 읽게 했다.

**이관한 단언:** 삭제된 두 테스트만 갖고 있던 릴리스 정체성 주장 — 워커는
`private: true`, 클라이언트·protocol은 발행 가능, 소비자는 vendored protocol 버전을
정확히 핀 — 을 `repo-gates.test.mjs`의 매니페스트 테스트로 옮겼다.
`worker-release-inputs.json`의 `forbidden_release_inputs` 내용 고정은
`worker-release-inputs.test.mjs`로 옮겼다(비우면 통과하던 상태였다).

## Current State

- 버전 `0.74.0`(루트와 `packages/ceal-worker-cli` 동일), 최신 태그 `ceal-v0.74.0`.
- `gateway-protocol-handoff-lock.json`이 handoff 소비의 단일 기록이다.
- 워크플로는 넷: `check.yml`, `ceal-release.yml`,
  `ceal-worker-stable-rollback.yml`, `npm-package-stage.yml`.
- 게이트: `npm run check` 통과, 약 1분 44초(이 호스트에서 `time`으로 측정).
  `check:unit`은 약 43초. 스위트는 둘뿐이다 — `test:contract`, `test:release`.

## Debt

이전 핸드오프에서 넘어온 항목들이다. **전부 미재확인**이므로 착수 전에 아직
참인지부터 확인할 것.

- **signed release manifest에 client 패키지가 없다.** `ceal-worker-release-manifest-<platform>.json`은
  protocol만 기록한다. 소비자에겐 source-owner 주장만 남는다. 진짜 해법은 manifest
  스키마에 client를 넣는 것이고 릴리스에 영향을 주는 변경이다.
- **acceptance 레코드의 receipt 가지가 allow-list가 아니다.** Gateway receipt event를
  projection 없이 통과시켜 `membership_ref`·`subject_ref`가 실린다.
- **레코드가 두 형식이다.** 리포 스크립트는 JSON, 설치형 명령은 YAML.
- **CI에 macOS 설치 레그가 없다.** `require_platform_proofs`를 이 공백의 근거로
  인용하면 틀린다. 그 플래그를 `linux-*` 전체에 요구한 것이 `ceal-v0.67.0`을 태웠고,
  지금은 `linux-amd64`로 좁혀 게이트가 지킨다.
- **worker `createLock`의 잔여 경합**이 미해결이다.
- **요구 3에 행위 테스트가 없다.** 다섯 경로의 발산 거부가 `repo-gates.test.mjs`의
  소스 형태 게이트로만 붙들려 있다. live pin이 수렴 상태라 행위로 falsify가 안 된다.
- **`assertWorkerReleaseSourcePath`의 유일한 호출자가 테스트다.**
  `worker-release-inputs.mjs:220`의 forbidden-path 적용 함수를 프로덕션 경로 어디서도
  안 부른다. 인벤토리는 선언만 하고 아무도 강제하지 않는 상태일 수 있다.

나머지는 해당 주석과 [gates.md](gates.md)가 소유한다.

## References

- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md) ·
  [운영자 수용 천장](operator-acceptance.md)
- [릴리스 provenance 패킷](requests/) — 이력이자 테스트가 참조하는 경로
