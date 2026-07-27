# Session Handoff
Date: 2026-07-27 — frozen 사본 드리프트 게이트를 랜딩했다(`protocol-vendor-pin.json` +
`scripts/verify-protocol-vendor-pin.mjs` + contract 테스트). 나머지 일감은 전부 `vinc` 대기.
push 상태·게이트 수치·이슈 상태는 **인용하지 말고 그 자리에서 확인할 것**.
**이 레인은 `corca-ai/ceal-cli`만 다룬다**(`ceal-agent`는 `vinc` 소유).

## Workflow Trigger

- 이 파일만 언급되면 **`## Next Session`을 번호 순서대로**. 1–5는 전부 `vinc` 응답 대기이므로,
  막힘 없는 코드 일감을 원하면 **6번**(품질 리뷰 3차의 active 카드 둘)으로 간다.
- prod 세션 생사는 `ceal capabilities --fresh`(read_only, 캐시 우회). `npm run probe`는
  **쓰지 말 것** — throwaway `HOME`이라 실세션을 답할 수 없다.
- 로컬 커밋은 진행하며, push·tag·GitHub write·Gateway write는 매번 따로 승인.
  **subagent는 승인 없이 띄운다**(`AGENTS.md ## Boundaries`).

## Continuation Capability

막힘 없는 코드 일감은 [품질 리뷰 3차](../charness-artifacts/quality/latest.md)
`## Recommended Next Quality Moves`의 active 카드 둘이다: `ceal update`에 데드라인 주기
(`stable-update.ts:189-215`, `install-ceal.sh`의 `curl`에 `--max-time` 없음), `createLock`
실패 정리에 소유권 검사 붙이기(`local-store-lock.ts:93-96`, 모양은 `releaseLock:105-112`).
**둘 다 읽기만 했고 재현은 안 했다.**

## Next Session

1. **정책 렌더링 리턴 패킷의 질문 둘** — 부재 문구를 모든 capability 행에 붙일지, 그리고
   이 레인의 필드 이해가 맞는지. [패킷](requests/2026-07-27-to-gateway-lane-announcement-policy-return-packet.md).
2. **증명/출하 갈림 처분** — sync를 유지할지 되돌릴지.
   [요청서](requests/2026-07-27-to-gateway-lane-proof-ship-divergence.md). 답이 오면
   `protocol-vendor-pin.json`의 `shipped.status`를 `agreed`로 닫거나 사본을 되돌린다.
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

- **열린 이슈는 `#6` 하나**, 완전히 `vinc` 대기.
- **protocol 사본의 정체성이 이제 기계가 읽는다.** `protocol-vendor-pin.json`이 셋을 적고
  게이트가 묶는다: 출처(`corca-ai/ceal@69ac63ae1`, tree `91125f98…`), 지금 사본의 해시,
  릴리스가 소비하는 locked archive의 subtree(`741cda25…` @ `57e23865…`). 증명/출하 갈림은
  `diverged`로 **선언**돼 있어 치명적이지 않지만, 사본 re-sync나 lock 범프가 선언을 만료시킨다.
  **owner(`41f88c1a…`) 대비 뒤처짐은 못 본다**(remote 미접근). 이 상태로 **릴리스 금지** —
  [게이트 상세](gates.md).
- **`vinc`에 요청/질문 다섯이 걸려 있고 전부 `oc`에 전달 완료.** 프롬프트는 `docs/requests/`가
  소유하고 운영자가 직접 넣는다. 기존 것들: [넷](requests/2026-07-27-to-gateway-lane.md),
  [막힘 판단 + 질문 둘](requests/2026-07-27-narnia-blocked-assessment.md),
  [공지 준비 리턴 패킷](requests/2026-07-27-to-gateway-lane-announcement-readiness.md).
- **`prod` 세션은 살아 있다**(2026-07-27T21:15–21:21Z 관측). 미검증은 `enrollments create` →
  `request_denied` 하나뿐(write라 미실행).
- **게이트**(2026-07-27 narnia): `npm run check` 45.5s, `check:unit` 20.7s. **이 수치를
  인용하지 말고 다시 잴 것** — 36코어 호스트 값이고 CI 러너는 코어가 훨씬 적다.
- **병렬 tier는 아직 narnia에서만 증명됐다.** ubuntu·macOS 러너는 push 후에야 안다.

## Discuss

- 2번 처분이 오면 `protocol-vendor-pin.json`을 어느 쪽으로 닫을지는 운영자 판단이 필요하다:
  사본을 owner로 다시 올릴지, locked artifact 쪽으로 되돌릴지.

## Debt

- **드리프트 게이트가 못 보는 것 셋**: owner 대비 staleness(remote 필요),
  `source.commit`·`shipped.protocol_tree`(로컬 확인 불가한 기록값),
  `git update-index --assume-unchanged`(의도적 우회) — 전부 [gates.md](gates.md)에 있다.
  CLI 블록(exit 2 경로)은 테스트가 없다.
- **`ceal-npm-release` 환경에 변수가 하나도 없다** → bare `v*` 태그를 밀면 첫 게이트에서 거절되며
  버전만 태운다. 이 레인은 bare `v*`를 밀지 않으므로 차단은 아니다.
- **frozen 사본 sync는 리포 분리 완료까지 대기**(운영자 판단, 2026-07-27). `cealctl-guide`와
  `ceal-guide`의 SKILL.md 중복(0.95)도 같은 이유로 `Deferred`.
- 나머지(drop count 하한, 관측기 HTML 소스 형태 검사, PLAUSIBLE 둘)는 품질 리뷰가 소유한다.


## References

- [품질 리뷰 2026-07-27 3차 — 현재 기준선](../charness-artifacts/quality/latest.md)
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md) ·
  [운영자 수용 천장](operator-acceptance.md)
- [`cealctl` 락 복구 불능 둘](requests/2026-07-27-to-gateway-lane-cealctl-lock-recovery.md) ·
  [protocol 아티팩트 정체성](requests/2026-07-27-to-gateway-lane-protocol-artifact-identity.md) ·
  [protocol 버전 정체성](requests/2026-07-27-to-gateway-lane-protocol-version-identity.md)
