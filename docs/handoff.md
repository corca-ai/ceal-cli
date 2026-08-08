# Session Handoff

## Workflow Trigger

이 파일만 언급되면 아래 `## Next Session — 테스트 감사

**지금 `npm run check:unit`이 1건 실패한다.** `cc29047`("fix(discovery): make the
cache window one measured decision")이 `skills/ceal-guide/SKILL.md`를 고치면서
`release-contract.json`의 기록된 digest를 갱신하지 않았다. 커밋별로 확인했고 그
직전 커밋까지는 전부 일치한다. 아직 push되지 않았으므로 pre-push 게이트
(`.githooks/pre-push` → `check:unit`)가 push 시점에 막을 상태다.

착수 전에 알아둘 것: **그 digest는 릴리스가 소비하지 않는다.**
`scripts/build-platform-binaries.mjs:126`의 `buildGuideAssets`는 파일에서 digest를
직접 재계산해서 매니페스트에 싣고, 계약에 적힌 값은 읽지도 않는다. 따라서
`release-contract.json`의 `guides[].sha256`은 **손으로 관리하는 파생값**이고 유일한
소비자는 두 테스트의 동일성 단언뿐이다
(`test/contract/worker-guide-contract.test.mjs:22`, `test/contract/guide-contract.test.mjs:29`).
문서를 한 글자 고치면 무관한 파일의 상수를 손으로 맞춰야 하고, 두 파일이 같은
트리에 있어 위조 방어도 되지 않는다.

할 일:

1. **가이드 digest 단언과 계약 필드를 없앨지 결정한다.** 단언만 지울지, 계약의
   `guides[].sha256` 필드까지 지울지는 릴리스 매니페스트 스키마와 서명 자산
   목록을 한 번 더 확인한 뒤 정한다. 같은 테스트의 나머지 단언(help 기반 발견을
   가르치는지, 명령 스냅샷을 박아두지 않았는지, `--help`가 광고하는 라우트를
   가이드가 베껴 쓰지 않는지)은 행위 계약이므로 유지 대상이다.
2. **테스트가 통째로 불필요하면 지운다.** 남길 가치가 digest 한 줄뿐이라면 파일을
   남길 이유가 없다.
3. **`test/contract/` 전체를 같은 눈으로 감사한다.** 손으로 관리하는 파생값,
   스냅샷 동일성, 그리고 리포 분리 이전의 레인 분업에서 생긴 계약이 더 있는지
   본다. 판단 기준: 이 단언이 깨지는 것이 **실제 결함**을 뜻하는가, 아니면 파일
   둘을 손으로 못 맞춘 것을 뜻하는가.

`docs/requests/`를 참조하는 테스트는 **이 감사에서 예외로 두거나 신중히 판단할
것.** 확인해 보니 잔재가 아니라, divergence를 선언하면 반드시 tracked 근거 문서를
가리켜야 한다는 거버넌스 규칙이고 `README.md`, `AGENTS.md:67`, `docs/gates.md:136`
세 곳이 같이 문서화하고 있다. 레인 잔재인 것은 그 디렉터리 안 파일들의 이름뿐이다.

## Current State`를 읽고, `## Debt`에서 고르거나 운영자가
지시한 작업을 시작한다. `ceal capabilities --fresh`와 `ceal call`은 실세션·provider
동작이라 승인 후에만.

## 2026-08-08 — 이전 핸드오프를 폐기했다

이 파일에 있던 내용은 전부 걷어냈다. 두 가지 이유다.

- **레인 개념이 사라졌다.** `to-narnia-*`/`from-narnia-*` 배턴 왕복, "레인 간 답은 세 곳을
  봐야 한다", 호스트별 소유 표시 같은 것들은 리포 분리가 진행되던 동안의 라우팅 장치였다.
  분리가 끝났으므로 더 이상 참이 아니다. `AGENTS.md`의 `## Host And Lane` 섹션도 같은 날
  같은 이유로 제거했다.
- **릴리스 상태가 세 판 낡았다.** 문서는 `ceal-v0.71.0`을 현재로 적고 있었으나 실제 태그는
  `ceal-v0.74.0`이다. `0.68.0` 아카이브 404, HPKE 결정 대기, Mac 수용 레코드 대기 같은
  대기 항목들도 그 시절 것이라 지금 상태를 반영한다고 볼 수 없다.

이력이 필요하면 `git log -- docs/handoff.md`에 그대로 남아 있다. 릴리스 provenance
패킷은 `docs/requests/`에 있고 **지우지 않았다** — `test/contract/protocol-vendor-pin.test.mjs`가
그 경로를 참조한다.

## Current State

리포에서 직접 확인한 것만 적는다.

- 버전 `0.74.0`(루트와 `packages/ceal-worker-cli` 동일), 최신 태그 `ceal-v0.74.0`.
- 직전 두 커밋: `cc29047` discovery 캐시 창을 하나의 측정된 결정으로 정리, `1ec4154`
  서명된 `gateway-protocol-handoff-v0.72.12` 소비.
- `gateway-protocol-handoff-lock.json`이 handoff 소비의 단일 기록이다.

그 밖의 현재 상태는 **재도출해야 한다.** 이 문서에 남아 있던 수치와 digest는 신뢰하지 말고
lock, 태그, 워크플로 실행 기록에서 다시 읽어라.

## Debt

이전 핸드오프에서 넘어온 리포 범위 항목들이다. **전부 미재확인**이므로, 착수 전에 아직
참인지부터 확인할 것.

- **signed release manifest에 client 패키지가 없다.** `ceal-worker-release-manifest-<platform>.json`은
  protocol만 기록한다. protocol-only 팩킷으로 바뀌면서 client 바이트를 덮던 전이 경로가
  사라졌고, 소비자에겐 source-owner 주장만 남는다. 진짜 해법은 manifest 스키마에 client를
  넣는 것이고 릴리스에 영향을 주는 변경이다.
- **acceptance 레코드의 receipt 가지가 allow-list가 아니다.** Gateway receipt event를 projection
  없이 통과시켜 `membership_ref`·`subject_ref`가 실린다. Gateway가 발급한 식별자를 Gateway에
  돌려주는 것이라 유출은 아니지만, 레코드의 "assembled by allow-list" 문구가 그 가지에
  대해서는 과장이다.
- **레코드가 두 형식이다.** 리포 스크립트는 JSON, 설치형 명령은 YAML(모든 공개 명령이 YAML
  한 문서라는 게이트 때문). 같은 스키마에 형식이 둘이면 소비자에게 지저분하다.
- **CI에 macOS 설치 레그가 없다.** `require_platform_proofs`는 릴리스·설치기 테스트 스위트
  얘기이므로 이 공백의 근거로 인용하면 틀린다. 그 플래그를 `linux-*` 전체에 요구한 것이
  `ceal-v0.67.0`을 태웠고, 지금은 `linux-amd64`로 좁혀 게이트가 지킨다.
- **worker `createLock`의 잔여 경합**이 미해결이다.
- **요구 3에 행위 테스트가 없다.** 다섯 경로의 발산 거부가 `repo-gates.test.mjs`의 소스 형태
  게이트로만 붙들려 있다. live pin이 수렴 상태라 행위로 falsify가 안 된다.

나머지는 해당 주석과 [gates.md](gates.md)가 소유한다.

## References

- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md) ·
  [운영자 수용 천장](operator-acceptance.md)
- [릴리스 provenance 패킷](requests/) — 이력이자 테스트가 참조하는 경로
