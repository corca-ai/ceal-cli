# Session Handoff

## Workflow Trigger

이 파일만 언급되면 아래 `## Current State`를 읽고, `## Debt`에서 고르거나 운영자가
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
