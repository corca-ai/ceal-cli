# Session Handoff
Date: 2026-07-28 — `vinc`의 답·계약 **아홉 통**을 들여왔고 **계획 검토를 끝냈다**(독립 두 판 +
로컬 대조). 아래 순서가 그 결과이고 근거·상세는
[계획 문서](../charness-artifacts/impl/2026-07-28-post-v0.66.1-plan.md)가 소유한다. 기다리던
**`gateway-handoff-v0.66.1`이 나왔다.** 게이트 수치·push·이슈는 다시 확인할 것.
**이 레인은 `corca-ai/ceal-cli`만 다룬다.**

## Workflow Trigger

- 이 파일만 언급되면 **`charness:impl`을 첫 착수 가능 항목(현재 2번)으로 시작한다.** 계획은
  끝났으니 **재계획도 chunked routing도 돌리지 말 것** — 기본 라우팅은 backlog를 다시 랭킹하려
  들고, 그건 이 순서를 되돌린다. 착수 전엔 그 항목의 원문과 계획 문서만 읽는다.
- prod 세션 생사 판정에만 `npm run probe`를 못 쓴다(설치 표면 포크는 여전히 probe만).
  `ceal capabilities --fresh`는 **실세션 readback**이라 승인 후에만.

## Continuation Capability

**지금 막힘 없이 되는 것: 2·3·4, 그리고 5를 브랜치에서.** 6은 1의 답이 와야 풀린다.
계획 문서의 "뒤집은 판단 셋"을 먼저 읽을 것 — 어제 핸드오프가 셋을 틀렸다.

## Next Session

1. **`vinc` 답 대기**(6이 걸린다). 질문 둘(`handoff_manifest_sha256`, 아카이브 입수 경로)은
   2026-07-28 [전달 완료](requests/2026-07-28-to-gateway-lane-artifact-consumption.md).
   **답은 `git fetch`로 안 온다** — `oc:~/ceal`의 untracked 노트를 직접 볼 것.
2. **렌더러 문구 확인·종료** — 이미 `index.ts:965`에 정확히 있고 concise·`--detail` 양쪽에 걸린다.
   **일감이 아니라 확인**이다.
3. **installed-acceptance result 계약 반환** —
   [요청](requests/from-gateway-lane/2026-07-27-candidate-result-ingress-contract.md).
   필수 사실 넷·불가 입력 여섯은 원문 그대로. 함정: 다른 답의 "private GitHub Release asset
   가능"과 합쳐 "release URL이면 된다"로 읽지 말 것(**가변 release 선택은 불가 입력**).
4. **`capability_access` 비추론 테스트** —
   [계약](requests/from-gateway-lane/2026-07-27-gateway-multi-target-selection-contract.md).
   지금 코드는 추론하지 않지만 **아무것도 그걸 붙들지 않는다.** 6과 무관하게 착수 가능.
5. **증명/출하 가드를 치명적으로** —
   [결정](requests/from-gateway-lane/2026-07-27-proof-ship-divergence-decision.md).
   **`main`에 바로 올리지 말고 브랜치에서** 6이 뒤따를 수 있을 때 함께 넣는다(`## Discuss`).
   비교는 **`pin.source.commit` 대 `lock.gateway.commit`**(자가 기록 필드 아님). 게이트만 붉히면
   요구 3은 미구현인 채 완료로 보인다 — 표면 넷·개발 전용 명령·문서 넷이 같은 슬라이스다.
6. **v0.66.1 소비**(1 이후): lock rebind + vendored 사본을 **`ac602cc1…`**로 re-sync + re-pin을
   **한 커밋으로**(따로 하면 `shipped_lock_mismatch`가 즉시 터진다). 끝나면 게이트가 초록이 되고
   **그게 5의 회귀 증명**이며 **`capability_ids`가 풀린다.** 릴리스·설치 증거는 태그·승인·Mac
   호스트가 걸린 별개 문제다.
7. **보류**: write-receipt readback은 v0.66.1이 **아직 안 받는다**(확인함), attachment는 원문이
   **구현 금지**, `corca-ai/ceal#633`은 `vinc` 대기이며 **명시적 go 없이 시작 금지**(prod 바인딩 파괴).

## Current State

- **`gateway-handoff-v0.66.1`을 로컬 대조했다**: tag `c5a44c3f…`, commit `2747f6b1…`, producer
  tree `b6728f2a…` **셋 다 일치**, protocol이 `0.66.1` 선언(0.65.0 사태 이후 처음으로 버전과
  정체성이 일치). **확인 못 한 것**: 아카이브·서명·인증서·cosign — Actions 아티팩트가 필요하다.
- **protocol subtree `ac602cc1…`는 owner 체크아웃에서 유도했다**(태그 커밋의
  `packages/ceal-protocol`) — **아홉 통에 없는 값**이니 pin에 넣을 때 근거를 함께 적을 것.
- **v0.66.1이 `capability_ids`는 받고 `write_request_ref`는 안 받는다**(태그의 protocol
  `index.ts` 205·199행).
- **레인 간 노트가 `git fetch`로 안 보인다.** `oc`는 자기 remote보다 34 커밋 앞이고 노트는
  untracked다. tracked 커밋으로 주고받자는 제안은 `vinc` 답 대기.
- **2026-07-27 기준 관측**(인용 말고 다시 잴 것): `check` 47.2s, `check:unit` 21.3s(36코어).

## Discuss

- **미푸시 커밋 넷** — push 승인 필요.
- 5를 언제 `main`에 넣을지 판단이 필요하다: 넣는 순간 6이 끝날 때까지 `main`이 붉고 6은 `vinc`
  답에 걸려 있다. 붉은 `main`은 `--no-verify` 습관을 만들고 그게 동결 경로를 지키는 유일한 장치를 끈다.

## Debt

- **동결 경로 우회가 열려 있다**: `packages/ceal-protocol`을 편집하고 pin의 `source.tree`만 올리면
  모든 검사가 통과한다. `capability_ids`를 손으로 푸는 사람의 자연스러운 다음 수라 특히 위험하다.
- **worker `createLock`의 잔여 경합은 이 레인 소유이고 미해결**(claim 없는 디렉터리 교체, inode
  20/20 재사용). Gateway가 가져간 건 **cealctl 쪽**이다.
- **CI에 macOS 설치 레그가 없다**(`require_platform_proofs: "0"`). Mac 설치·핸드셰이크 증거는 이
  레인 손에 호스트가 없다.
- 나머지(가드가 수렴을 관측 못 하는 한계, update 파이프 해제 미게이트, 설치기 `curl` 변수 호출
  우회, drop count 하한, 관측기 HTML 검사)는 해당 주석·[gates.md](gates.md)·품질 리뷰가 소유한다.

## References

- [계획 문서](../charness-artifacts/impl/2026-07-28-post-v0.66.1-plan.md) — 순서의 근거와 상세
- [Gateway 레인 답·계약 아홉](requests/from-gateway-lane/) — **원문이 authoritative**
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md) ·
  [운영자 수용 천장](operator-acceptance.md) · [품질 리뷰 3차](../charness-artifacts/quality/latest.md)
