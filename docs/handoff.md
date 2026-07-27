# Session Handoff
Date: 2026-07-27 — `vinc` 대기 중 **자율 개선 한 판**을 돌렸고(게이트 ~98s → 44s, 재현까지
마친 결함 다섯), 그 뒤 `vinc`의 정책 렌더링 요청까지 처리했다. 요청서/리턴 패킷 **다섯을
`oc`에 전달**했고 전부 push했다. 다음 세션의 일감은 `## Continuation Capability` **3 → 1 → 2**.
push 상태는 세어서 확인할 것(`git log @{u}..HEAD`).
**이 레인은 `corca-ai/ceal-cli`만 다룬다**(`ceal-agent`는 `vinc` 소유).

## Workflow Trigger

- 이 파일만 언급되면 **`## Continuation Capability`의 3 → 1 → 2**부터. `## Next Session (전부 `vinc` 대기)

1. **정책 렌더링 리턴 패킷의 질문 둘** — 부재 문구를 모든 capability 행에 붙일지, 그리고
   이 레인의 필드 이해가 맞는지. [패킷](requests/2026-07-27-to-gateway-lane-announcement-policy-return-packet.md).
2. **증명/출하 갈림 처분** — sync를 유지할지 되돌릴지. 이 답이 위 3번 게이트의 형태를 정한다.
   [요청서](requests/2026-07-27-to-gateway-lane-proof-ship-divergence.md).
3. **새 versioned signed artifact** — 나와야 렌더러가 출하 가능해진다. 그전까지 렌더러는
   증명되지만 동작하지 않는다(locked artifact가 필드를 거부).
4. **protocol 버전 정책** — owner 결정은 받았다("동일 버전 재빌드는 identity-preserving 아님",
   artifact tuple을 인용할 것). 새 tuple이 아직 없다.
5. **`#6` 원장** — `current_stage: 2` 그대로, `rollback.rehearsals` 빈 배열.
   `@corca-ai/ceal-protocol`은 npm 404이고, **운영자 판단(2026-07-27): 임의 머신 해석은
   불필요하므로 npm 발행은 `#6`에 필요 없다.**
6. **`#633` 미관측 축 셋** — 처분 답 없음. dev 재등록은 이 호스트의 prod 바인딩을 파괴하므로
   명시적 go 없이 시작하지 말 것.

## Current State

- **열린 이슈는 `#6` 하나**, 완전히 `vinc` 대기(위 2번).
- **`vinc`에 요청/질문이 걸려 있다.** 프롬프트는 `docs/requests/`가 소유하고 운영자가
  직접 넣는다. **새로 둘 추가, 둘 다 `oc`에 전달 완료**:
  [`cealctl` 락 복구 불능 둘](requests/2026-07-27-to-gateway-lane-cealctl-lock-recovery.md)
  — worker에서 고친 결함 둘이 frozen인 `ceal-operator-cli`에 그대로 있고, **operator store의
  빌드된 코드로 직접 재현했다**(zero-byte `owner.json`·pid 1 `EPERM` 둘 다 `unsafe_state_path`
  즉시, missing-owner 대조군은 정상 회수). 그리고
  [protocol 아티팩트 정체성 + 레인 사실 정정 둘](requests/2026-07-27-to-gateway-lane-protocol-artifact-identity.md)
  — **`#6`에 npm은 필요 없다**는 결론(운영자 판단 2026-07-27: 임의 머신 해석 불필요)과,
  `vinc`가 stale 클론으로 이 레인을 평가한 건·`dist-*` 귀속 오류 정정. 그리고 **셋째·넷째**:
  [protocol 버전이 바이트를 구분하지 못한다](requests/2026-07-27-to-gateway-lane-protocol-version-identity.md)
  — 아래 `## Closed` 참조. 그리고 [증명/출하 갈림](requests/2026-07-27-to-gateway-lane-proof-ship-divergence.md)
  — vendored 프로토콜과 릴리스가 소비하는 locked artifact가 갈렸고 게이트가 못 잡는다.
  그리고 [정책 렌더링 리턴 패킷](requests/2026-07-27-to-gateway-lane-announcement-policy-return-packet.md).
  **다섯 다 `oc`에 전달 완료.** 기존 것들:
  [기존 넷](requests/2026-07-27-to-gateway-lane.md), 그리고 오늘의
  [막힘 판단 + 질문 둘](requests/2026-07-27-narnia-blocked-assessment.md) — 후자는
  `oc:~/ceal/2026-07-27-from-narnia-blocked-assessment.md`로 이미 전달했다(새 untracked 최상위
  `*.md` 하나만 추가; tracked 파일 무변경).
- **공지 준비 리턴 패킷은 전달 완료** — `oc:~/ceal/2026-07-27-from-narnia-announcement-readiness-return-packet.md`
  (새 untracked 최상위 `*.md` 하나만 추가; tracked 파일 무변경, digest 대조함).
- **`prod` 세션은 살아 있다**(2026-07-27T21:15–21:21Z 관측). 미검증은 `enrollments create` →
  `request_denied` 하나뿐(write라 미실행).
- **frozen protocol 사본이 owner보다 뒤처져 있다(의도적, 위 3번 참조)**: 여기
  `91125f983602012712abc3bc8c886ecb4c8fe406`, owner `41f88c1a13d1895538b7c979eff6a79870c9e92c`.
  차이는 Slack scope 문장 한 줄. 이 상태로는 **릴리스하면 안 된다** — 릴리스가 소비하는
  locked artifact는 또 다른(더 오래된) 바이트다.
- **게이트**(2026-07-27 narnia, 병렬화 이후): `npm run check` 43.4–46.8s 통과, `check:unit`
  21.8s. **이 수치를 인용하지 말고 다시 잴 것** — 36코어 호스트 값이고, CI 러너는 코어가
  훨씬 적다(`--test-concurrency` 2에서 37.3s, 4에서 26.5s로 측정).
- **병렬 tier는 아직 narnia에서만 증명됐다.** ubuntu·macOS 러너에서 초록인 것은 push 후에야
  안다. 의심 지점 둘은 품질 리뷰 `## Weak`에 적어 뒀다(`~/.npm/_cacache` 동시 접근,
  `build-worker-release-artifact.test.mjs:111`의 pid 기반 tmp 경로).
- **`@corca-ai/ceal-protocol@0.65.0`은 바이트가 세 벌**(버전 미범프 재빌드). 새로 핀할 땐
  producing commit+tree에 묶을 것.

## Debt

- **~~`docs/operator-acceptance.md`가 없다`~~ — 2026-07-27 작성됨.** 천장(`version`/
  `commands`/`guide status`/`observe`), 상대역을 호스트명이 아니라 **역할**로, 태그를 태우기
  전에 확인할 릴리스 레인 접근물과 각각의 read-only 확인 명령을 담았다. 그 과정에서 확인된
  것: **`ceal-npm-release` 환경에 변수가 하나도 없다** → 지금 bare `v*` 태그를 밀면 첫 게이트에서
  바로 거절되며 버전만 태운다. 이 레인은 bare `v*`를 밀지 않으므로 차단은 아니지만, 기록해 둔다.
- **drop count는 언제나 하한이지 총계가 아니다.** SIGKILL, `HOME` 미설정, 카운터 자체의 실패는
  세어지지 않는다. `dropped_appends_are_a_floor`가 페이로드에 이걸 명시한다.
- **관측기 HTML 검사는 소스 형태 검사다.** 분기 **삭제**는 잡고 **무력화**(`if (false)`)는 못 잡는다.
  닫으려면 게이트에 DOM이 필요하다.
- **frozen 사본 sync는 리포 분리 완료까지 대기** — 설계하지 않기로 했다(운영자 판단, 2026-07-27).
  `skills/cealctl-guide`와 `ceal-guide`의 SKILL.md 중복(0.95)도 같은 이유로 `Deferred`.
- **미해결 PLAUSIBLE 둘**: `recordDrop`의 cap 검사가 N개 프로세스에서 최대 N-1바이트 초과 가능
  (표시상 불일치뿐), `prepareDirectory`의 `mkdir` 오류 순서가 macOS/BSD에서 Linux와 같은지는
  mac 러너에서만 확인 가능.

## References

- [품질 리뷰 2026-07-27 3차 — 현재 기준선](../charness-artifacts/quality/latest.md)
- [`cealctl` 락 복구 불능 둘](requests/2026-07-27-to-gateway-lane-cealctl-lock-recovery.md) ·
  [protocol 아티팩트 정체성과 레인 사실 정정](requests/2026-07-27-to-gateway-lane-protocol-artifact-identity.md)
- [Gateway 레인 요청 넷](requests/2026-07-27-to-gateway-lane.md) ·
  [막힘 판단과 질문 둘](requests/2026-07-27-narnia-blocked-assessment.md) ·
  [공지 준비 리턴 패킷](requests/2026-07-27-to-gateway-lane-announcement-readiness.md)
- [운영자 수용 천장](operator-acceptance.md)
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md)
