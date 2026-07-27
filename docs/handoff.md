# Session Handoff
Date: 2026-07-27 — 품질 리뷰까지 끝났고, **다음 세션 일감은 그 리뷰가 안 고치고 남긴 것들**이다.
로컬 커밋 3개가 push 대기(`3503a8f`, `349ce36`, `1009081`).
**이 레인은 `corca-ai/ceal-cli`만 다룬다**(`ceal-agent`는 `vinc` 소유).

## Workflow Trigger

- 이 파일만 언급되면 **Next Session을 번호 순서대로**. 1번이 유일하게 막힘 없는 일감이고,
  2·3번은 `vinc` 응답 대기다.
- 세션 도중 prod 세션 생사가 필요하면 `ceal capabilities --fresh` — `read_only`이고 캐시를
  우회해 실제 왕복한다. `npm run probe`는 **쓰지 말 것**(throwaway `HOME`이라 실세션을 답할 수 없다).
- 스킬: 1번은 `charness:impl`. 로컬 커밋은 진행하며, push·tag·GitHub write·Gateway write는
  매번 따로 승인. **subagent는 승인 없이 띄운다**(`AGENTS.md ## Boundaries`).
- 문서에 적힌 게이트 수치·push 상태·이슈 상태를 **인용하지 말고 그 자리에서 확인할 것**.
  이 baton은 그걸로 두 번 틀렸다(push 대기 커밋 수, `#633` 개폐 여부).

## Continuation Capability

막힘 없는 일감 5개가 [`charness-artifacts/quality/latest.md`](../charness-artifacts/quality/latest.md)의
`## Recommended Next Quality Moves`에 카드 형태로 있다. 나머지는 전부 `vinc` 대기다.

## Next Session

1. **품질 리뷰가 남긴 것들** — 전부 이 레인 소유, 승인 불필요. 위험도 순:
   - **`probe-surface.test.mjs:62-63,78-82`가 실행되지 않는 분기 위에서 증명한다.**
     `probe-surface.mjs:92`가 `dist/bin.js`를 맨 `node`로 띄우므로 `bin.ts:38`이 `process.execPath`를
     guide store에 넘기고, `agent-guide.ts:168-172`가 staged guide를 못 찾아 `guide register`가 항상
     `guide_unavailable`(경로가 아예 없는 문서)을 답한다. `doesNotMatch(HOME)`은 공허하고
     `CLAUDE_CONFIG_DIR` 봉쇄를 검사하는 `if (reported)` 가지는 죽어 있다. **probe guard의 안전
     속성이 지금 미증명이다.** 소스 추적으로만 확인했고 실행 확인은 안 했다 —
     `npm run probe -- --allow-effect local_write ceal guide register claude` 한 번이면 결판난다.
   - **credential store에 temp sweep이 없다.** `receipt-spool.ts:229`는 append마다
     고아 `.tmp`를 쓸어내는데 `profile-store.ts`·`discovery-cache.ts`는 안 한다. write와 rename
     사이 크래시가 **두 토큰을 담은 0o600 `.tmp` 파일을 영구히** 남긴다. 가장 필요한 쪽에 없다.
   - **observer 픽스처 둘이 store 인터페이스와 어긋났다**(`observer.test.mjs:573-608`).
     `.mjs`라 `tsc`가 못 본다. 실제 store로 만들면 닫힌다(같은 파일 `:66`·`:479`가 이미 그렇게 한다).
   - **privacy 스윕이 store 모양이 아니라 이름 모양이다**(`observer.test.mjs:380`).
     지금 자기 하한 `>= 4`에 정확히 걸려 있고, 명명 규칙을 벗어난 새 store 파일은 안 보인다.
   - **`docs/operator-acceptance.md`** — 아래 `## Debt` 참조.
   - 낮음(passive): 게이트 타이밍 기계 수집, `index.ts:1102-1107`의 캐시 키가 협상된 프로토콜
     버전 대신 클라이언트 상수를 쓰는 것(현재는 디코더가 막아 잠복).
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
- **`vinc`에 요청/질문 다섯이 걸려 있다.** 프롬프트는 `docs/requests/`가 소유하고 운영자가
  직접 넣는다: [기존 넷](requests/2026-07-27-to-gateway-lane.md), 그리고 오늘의
  [막힘 판단 + 질문 둘](requests/2026-07-27-narnia-blocked-assessment.md) — 후자는
  `oc:~/ceal/2026-07-27-from-narnia-blocked-assessment.md`로 이미 전달했다(새 untracked 최상위
  `*.md` 하나만 추가; tracked 파일 무변경).
- **`prod` 세션은 살아 있다**(2026-07-27T21:15–21:21Z 관측). 미검증은 `enrollments create` →
  `request_denied` 하나뿐(write라 미실행).
- **게이트**(2026-07-27 narnia 측정): `npm run check` 1:38.70–1:48.07, 통과 **383**개;
  `check:unit` ~23s, 통과 **336**개. 이 수치를 인용하지 말고 다시 잴 것.
- **`@corca-ai/ceal-protocol@0.65.0`은 바이트가 세 벌**(버전 미범프 재빌드). 새로 핀할 땐
  producing commit+tree에 묶을 것.

## Debt

- **`docs/operator-acceptance.md`가 없다.** 승계자를 막는 게 이제 구체적이다:
  `docs/release-and-enrollment.md:32-40`의 **모든 단계가 `vinc`**(`ssh oc`, owner `cealctl` 사본)인데
  담당자도 접근 요청 경로도 대안도 적힌 데가 없다. 그 세션 없이 도달 가능한 최대 증명은
  `version`/`commands`/`guide status`/`observe`이고 **그게 천장이라는 말이 어디에도 없다**.
  릴리스 레인은 더 나쁘다 — 자격이 없는 승계자는 **태그 하나를 태워서** 그걸 알게 되고,
  `CHANGELOG.md`가 기록하듯 태운 태그는 재사용할 수 없다.
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
  [막힘 판단과 질문 둘](requests/2026-07-27-narnia-blocked-assessment.md)
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md)
