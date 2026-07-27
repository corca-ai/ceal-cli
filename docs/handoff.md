# Session Handoff
Date: 2026-07-27 — `vinc`의 **답 여섯 통을 뒤늦게 발견**해 리포로 들여왔다
(`docs/requests/from-gateway-lane/`). 막힘 없는 일감이 넷 생겼고, **하나는 오늘 이 레인이
랜딩한 것의 심각도를 정정하는 일**이다. 게이트 수치·push·이슈 상태는 다시 확인할 것.
**이 레인은 `corca-ai/ceal-cli`만 다룬다.**

## Workflow Trigger

- 이 파일이 언급되면 — **다른 지시가 함께 오더라도** — `## Next Session` 전체를 한 판으로
  **계획하는 것이 먼저다.** 특정 번호부터 바로 구현에 들어가지 말 것. 계획 전에
  `docs/requests/from-gateway-lane/` 여섯 통을 읽는다(**원문이 authoritative**). 계획 우선은
  원문이 아니라 **이 레인의 판단**이다: 1의 "acceptance-candidate emission"과 2의 산출물이
  같은 경로다.
- prod 세션 생사 판정에만 `npm run probe`를 못 쓴다(throwaway `HOME`) — 설치 표면 포크는
  여전히 probe가 유일한 승인 경로다. `ceal capabilities --fresh`는 **실세션 readback**이라
  게이트와 다른 행위다 — 승인 후에만.

## Continuation Capability

막힘 없는 일감 넷. 1·2는 같은 경로를 건드려 얽혀 있고 3·4는 독립적이지만 **착수 순서는
계획에서 정한다.** `cealctl`의 lock-recovery만 Gateway가 가져갔다(`## Debt` 참조).

## Next Session

1. **증명/출하 가드** — [결정](requests/from-gateway-lane/2026-07-27-proof-ship-divergence-decision.md).
   갈림은 **출하 차단**, sync는 유지, `npm run check`는 **실패**해야 한다. 요구 전문(거부할 표면
   넷, 개발 전용 명령 조건, 코드 명명)은 원문에. 원문에 없는 것 둘:
   - 비교는 vendored producer commit/tree **대 handoff lock**이다 — `protocol-vendor-pin.json`의
     자가 기록 필드에 판정을 걸면 저자 진술을 검증으로 착각한다(`## Debt`).
   - 심각도를 뒤집으면 `AGENTS.md` 게이트 규칙과 `gates.md`의 "declarable rather than fatal"
     절이 거짓이 된다 — **같은 슬라이스에서 함께 고칠 것.**
2. **installed-acceptance result 계약 반환** —
   [요청](requests/from-gateway-lane/2026-07-27-candidate-result-ingress-contract.md).
   필수 사실 넷과 **불가 입력 여섯**은 원문 목록 그대로. 원문에 없는 함정: 다른 답의 "바인딩과
   rollback 쌍이 있으면 private GitHub Release asset 가능"과 합쳐 "release URL이면 된다"로 읽기
   쉽다 — **아니다**(가변 release 선택은 불가 입력). 계약 반환일 뿐 태그·발행·설치는 미승인.
3. **복수 capability 선택** —
   [계약](requests/from-gateway-lane/2026-07-27-gateway-multi-target-selection-contract.md).
   반복 `--capability` → `capability_ids`, scalar 호환 유지. 원문에 없는 주의: **protocol
   `1.3.0` 그대로인 additive 변경이므로 동결된 `packages/ceal-protocol`을 건드리지 말 것.**
4. **렌더러 재검증** — [ack](requests/from-gateway-lane/2026-07-27-announcement-policy-return-ack.md).
   문구는 정확히 **`scope not declared by the Gateway`**, 모든 capability 행, concise·`--detail`
   양쪽. attestation 해석도 owner 확인됨. **양쪽 다 가정 말고 확인할 것.**
5. **`vinc` 대기 — 새 versioned signed artifact.** 답 셋이 하류의 전제로 지목한다.
6. **`vinc` 대기 — `corca-ai/ceal#633` 미관측 축 셋.** 여섯 통에 처분이 없다. 이 레인이 돌리려면
   dev 인스턴스명 + Gateway 재시작이 필요하고, **dev 재등록이 prod 바인딩을 파괴하므로 명시적 go
   없이 시작 금지.**

## Current State

- **답 여섯 통을 `docs/requests/from-gateway-lane/`에 digest 대조 복사했다.** 원본이
  `oc:~/ceal`의 untracked 파일이라 `git fetch`로 안 보인 게 하루를 잃은 원인 —
  **앞으로 레인 간 노트는 tracked 커밋으로 push한다**(`vinc` 답과 무관하게).
- **protocol 트리가 넷이다**: 출하 `741cda25…`(lock `57e23865…`), vendored `91125f98…`,
  푸시된 owner `41f88c1a…`, `oc` 미푸시 `d1185c92…`. **버전은 정체성이 아니다** — producer tuple을
  인용, `0.65.0` 단독 금지. `corca-ai/ceal-cli#6`은 레지스트리 발행 불필요(둘 다 owner 결정).
- **2026-07-27 기준 관측**(인용 말고 다시 잴 것): `check` 47.2s, `check:unit` 21.3s(36코어;
  CI 러너는 훨씬 적다). CI는 ubuntu-24.04·macos-15 둘 다 green이었다.

## Discuss

- **미푸시 커밋 하나**(`4bbf795`) — push 승인 필요.
- 노트를 tracked 커밋으로 주고받자는 제안은 `vinc` 답 대기 중이다.

## Debt

- **worker `createLock`의 잔여 경합은 이 레인 소유이고 미해결이다.** 경쟁자가 **claim 없이**
  디렉터리를 갈아치우면 둘 다 홀더라고 믿는다. `rmdir`+`mkdir`가 inode를 **20/20 재사용**해
  `ino`로는 구분 불가(`local-store-lock.ts` 주석). Gateway가 가져간 건 **cealctl 쪽**이지
  이 파일이 아니다.
- **드리프트 게이트가 못 보는 것**: owner 대비 staleness, `source.commit`·`shipped.protocol_tree`
  (로컬 확인 불가 — 1번이 여기 판정을 걸면 안 되는 이유), CLI exit 2 경로 — [gates.md](gates.md).
- **update 파이프 해제는 게이트가 없고**(그룹 kill 때문에 재현 불가), 설치기 게이트는 `curl`
  **변수 호출** 우회를 못 잡는다 — 둘 다 주석에 근거 있음.
- 나머지(drop count 하한, 관측기 HTML 검사, PLAUSIBLE 둘)는 품질 리뷰가 소유한다.

## References

- [Gateway 레인 답 여섯](requests/from-gateway-lane/) — **원문이 authoritative**
- [이 레인의 회신·미해결 요약](requests/2026-07-27-to-gateway-lane-outstanding.md)
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md) ·
  [운영자 수용 천장](operator-acceptance.md) · [품질 리뷰 3차](../charness-artifacts/quality/latest.md)
