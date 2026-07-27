# Session Handoff
Date: 2026-07-27 — **품질 리뷰가 남긴 이 레인 몫은 전부 닫혔고**, `vinc`의 공지 준비
요청에 대한 리턴 패킷을 써서 `vinc`에 전달했다. 남은 건 전부 `vinc` 대기다. push 상태는 세어서 확인할 것
(`git log @{u}..HEAD`).
**이 레인은 `corca-ai/ceal-cli`만 다룬다**(`ceal-agent`는 `vinc` 소유).

## Workflow Trigger

- 이 파일만 언급되면 **Next Session을 번호 순서대로**. 셋 다 `vinc` 응답 대기이므로
  막힘 없는 코드 일감은 없다. 새 일감이 필요하면 품질 리뷰를 다시 돌릴 것.
- 세션 도중 prod 세션 생사가 필요하면 `ceal capabilities --fresh` — `read_only`이고 캐시를
  우회해 실제 왕복한다. `npm run probe`는 **쓰지 말 것**(throwaway `HOME`이라 실세션을 답할 수 없다).
- 로컬 커밋은 진행하며, push·tag·GitHub write·Gateway write는 매번 따로 승인.
  **subagent는 승인 없이 띄운다**(`AGENTS.md ## Boundaries`).
- 문서에 적힌 게이트 수치·push 상태·이슈 상태를 **인용하지 말고 그 자리에서 확인할 것**.
  이 baton은 그걸로 두 번 틀렸다(push 대기 커밋 수, `#633` 개폐 여부).

## Continuation Capability

막힘 없는 일감은 지금 없다. [`charness-artifacts/quality/latest.md`](../charness-artifacts/quality/latest.md)의
`## Recommended Next Quality Moves` 카드 다섯 중 **active 다섯이 모두 닫혔고**, 남은 둘은
원래 passive다. 나머지 일감은 전부 `vinc` 대기다.

## Closed This Session (2026-07-27)

품질 리뷰가 남긴 이 레인 몫 다섯, 전부 falsification까지 확인:

- **probe guard의 안전 속성** — 리뷰의 의심이 맞았다. 실행으로 결판냈고(`guide register`가
  항상 `guide_unavailable`), 이제 테스트가 install 모양 트리에 `node`를 hardlink해 route를
  실제로 도달시킨 뒤 경로를 **긍정문으로** 검사한다. sentinel은 선언 테이블에서 파생하므로
  새 host가 봉쇄 없이 추가되면 여기서 깨진다. `probe-surface.mjs:103` 제거 → 실패 확인함.
- **atomic write에 주인이 생겼다** — `local-store-file.ts`. 세 store가 베껴 쓰던 write
  프로토콜을 한곳으로 모으면서 credential store와 discovery cache에 없던 sweep이 생겼다.
  리뷰가 추가로 잡아낸 것도 같이 고쳤다: `chmod`를 rename **전에** temp에 걸어 planted-path
  창을 없앴고, prefix를 검증하며, sweep은 논리 시계가 아니라 벽시계를 읽는다.
- **observer 픽스처 둘을 실제 store로** 만들었고, **privacy 스윕은 이름이 아니라 디스크를**
  읽는다(+ `createCeal*Store` 팩토리 게이트). 규칙 밖 이름의 store 파일 추가 → 실패 확인함.
- **`docs/operator-acceptance.md`를 썼다** — 아래 `## Debt` 참조.

## Next Session

1. **공지 준비(announcement readiness) — 리턴 패킷은 썼고, 공은 `vinc`에 있다.**
   요청서는 `oc:~/ceal/docs/requests/2026-07-27-to-narnia-ceal-cli-internal-announcement-readiness.md`.
   답은 [리턴 패킷](requests/2026-07-27-to-gateway-lane-announcement-readiness.md).
   - 증거 있는 플랫폼은 **`linux-amd64` 하나뿐**이다. 나머지 셋은 서명된 에셋만 있고 설치
     증거가 없다. Mac·arm64 기기를 누가 줄지가 정해지기 전에는 공지에 넣을 수 없다.
   - `npm run accept:worker`가 그 증거를 기계로 만든다. bounded call은 opt-in이다
     (`--capability`/`--target`) — 실제 provider 동작이라 기본값이 아니다.
   - 요청 3번(정책 범위 렌더링)은 **descriptor에 필드가 없어서 막혀 있다.** 패킷 §4가
     필요한 필드 여섯을 정확히 지목했다. `vinc` 답이 오면 그때 렌더링을 붙인다.
2. **`#6` rollback rehearsal — `vinc` 대기이고, 아직 이 레인 차례가 아니다.**
   2026-07-27 확인: ledger `current_stage: 2`(`cli_source`, in_progress), `#6`이 사는
   stage 5 `consumer_cutover`는 `planned`, `rollback.rehearsals`는 빈 배열.
   그리고 **`@corca-ai/ceal-protocol`이 npm에 없다**(404) — `#6`의 수용 증거가 요구하는
   "immutable, Gateway-owned packed artifact"가 소비할 수 있게 존재하지 않는다. 오늘 검증된
   tarball은 `private_agent_host` 쪽이고 별개 소비자다. `vinc`에 질문을 넣어 뒀다.
3. **`corca-ai/ceal#633` 미관측 축 셋 — 처분 결정 대기.** 이슈는 2026-07-26에 **closed**다
   (`vinc`의 라이브 증명). cursor continuation은 그 증명에 포함됐으므로 **드롭**. 남은 셋은
   포함 안 됐다: `message_ref` TTL **만료**(발견 가능성만 확인됨), 재시작 후 cursor 생존,
   `since`/`until` 경계 페이지. 드롭할지·`vinc`가 새 이슈로 가져갈지·이 레인이 돌릴지 물어 뒀다.
   이 레인이 돌리려면 dev 인스턴스 이름 + Gateway 재시작(둘 다 `vinc`)이 필요하고,
   **dev 재등록은 이 호스트의 prod 바인딩을 파괴한다.** 명시적 go 없이는 시작하지 말 것.

## Current State

- **열린 이슈는 `#6` 하나**, 완전히 `vinc` 대기(위 2번).
- **`vinc`에 요청/질문이 걸려 있다.** 프롬프트는 `docs/requests/`가 소유하고 운영자가
  직접 넣는다: [기존 넷](requests/2026-07-27-to-gateway-lane.md), 그리고 오늘의
  [막힘 판단 + 질문 둘](requests/2026-07-27-narnia-blocked-assessment.md) — 후자는
  `oc:~/ceal/2026-07-27-from-narnia-blocked-assessment.md`로 이미 전달했다(새 untracked 최상위
  `*.md` 하나만 추가; tracked 파일 무변경).
- **공지 준비 리턴 패킷은 전달 완료** — `oc:~/ceal/2026-07-27-from-narnia-announcement-readiness-return-packet.md`
  (새 untracked 최상위 `*.md` 하나만 추가; tracked 파일 무변경, digest 대조함).
- **`prod` 세션은 살아 있다**(2026-07-27T21:15–21:21Z 관측). 미검증은 `enrollments create` →
  `request_denied` 하나뿐(write라 미실행).
- **게이트**(2026-07-27 narnia 재측정): `npm run check` 1:39.76→2:02.25 통과, **394**개;
  `check:unit` 23.5–31.8s. 이 수치를 인용하지 말고 다시 잴 것.
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

- [품질 리뷰 2026-07-27 2차 — 현재 기준선](../charness-artifacts/quality/latest.md)
- [Gateway 레인 요청 넷](requests/2026-07-27-to-gateway-lane.md) ·
  [막힘 판단과 질문 둘](requests/2026-07-27-narnia-blocked-assessment.md) ·
  [공지 준비 리턴 패킷](requests/2026-07-27-to-gateway-lane-announcement-readiness.md)
- [운영자 수용 천장](operator-acceptance.md)
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md)
