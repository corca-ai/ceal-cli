# Session Handoff
Date: 2026-07-27 — frozen 사본 드리프트 게이트를 랜딩했다(`protocol-vendor-pin.json` +
`scripts/verify-protocol-vendor-pin.mjs` + contract 테스트). 나머지 일감은 전부 `vinc` 대기.
push 상태·게이트 수치·이슈 상태는 **인용하지 말고 그 자리에서 확인할 것**.
**이 레인은 `corca-ai/ceal-cli`만 다룬다**(`ceal-agent`는 `vinc` 소유).

## Workflow Trigger

- 이 파일만 언급되면 **`## Continuation Capability`부터**. `## Next Session`은 1–6이 **전부**
  `vinc` 응답 대기라 지금 착수할 수 없다 — 답이 오면 그때 번호 순서대로.
- prod 세션 생사는 `ceal capabilities --fresh`(read_only, 캐시 우회). `npm run probe`는
  **쓰지 말 것** — throwaway `HOME`이라 실세션을 답할 수 없다.
- 로컬 커밋은 진행하며, push·tag·GitHub write·Gateway write는 매번 따로 승인.
  **subagent는 승인 없이 띄운다**(`AGENTS.md ## Boundaries`).

## Continuation Capability

막힘 없는 코드 일감 하나 남았다: **`ceal update`에 데드라인 주기**
(`stable-update.ts:189-215`, `install-ceal.sh`의 `curl`에 `--max-time` 없음). 블랙홀 연결이나
동시 update가 걸리면 envelope 없이 무한 대기한다 — 이 CLI의 다른 모든 대기는 유계다.
**읽기만 했고 재현은 안 했다.** 증명 경계는 블랙홀 주소를 향해 설치기를 겨눠 유계 실패
envelope을 확인하는 것. [품질 리뷰 3차](../charness-artifacts/quality/latest.md) 참조.

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
- **protocol 사본 정체성을 이제 기계가 읽는다.** `protocol-vendor-pin.json`: 출처
  (`corca-ai/ceal@69ac63ae1`, tree `91125f98…`), 사본 해시, locked archive subtree
  (`741cda25…` @ `57e23865…`). 갈림은 `diverged`로 **선언**돼 있고 re-sync·lock 범프가 만료시킨다.
  **owner(`41f88c1a…`) 대비 뒤처짐은 못 본다**. 이 상태로 **릴리스 금지** — [gates.md](gates.md).
- **`vinc`에 요청/질문 다섯이 걸려 있고 전부 `oc`에 전달 완료.** 프롬프트는 `docs/requests/`가
  소유하고 운영자가 직접 넣는다 — 목록은 `## References`.
- **`prod` 세션은 살아 있다**(2026-07-27T21:15–21:21Z 관측). 미검증은 `enrollments create` →
  `request_denied` 하나뿐(write라 미실행).
- **게이트**(2026-07-27 narnia): `npm run check` 46.8s, `check:unit` 21.3s. **이 수치를
  인용하지 말고 다시 잴 것** — 36코어 호스트 값이고 CI 러너는 코어가 훨씬 적다.
- **병렬 tier가 CI 러너에서 증명됐다** — `03382ba` run 30261335515, ubuntu-24.04·macos-15
  **둘 다 success**. 의심하던 둘(`~/.npm/_cacache` 동시 접근, pid 기반 tmp 경로)은 조용했다.
  품질 리뷰 3차의 active 카드 셋 중 둘이 이걸로 닫혔다.

## Discuss

- 2번 처분이 오면 `protocol-vendor-pin.json`을 어느 쪽으로 닫을지는 운영자 판단이 필요하다:
  사본을 owner로 다시 올릴지, locked artifact 쪽으로 되돌릴지.

## Debt

- **드리프트 게이트가 못 보는 것 둘**: owner 대비 staleness(remote 필요),
  `source.commit`·`shipped.protocol_tree`(로컬 확인 불가한 기록값) — [gates.md](gates.md) 참조.
  CLI 블록(exit 2 경로)은 테스트가 없다.
- **`createLock`에 남은 경합**(고친 것과 다른 갈래): 경쟁자가 디렉터리를 **claim 없이**
  갈아치우면 write가 상대 디렉터리에 성공해 둘 다 홀더라고 믿는다. `rmdir`+`mkdir`가 inode를
  **20/20 재사용**해 `ino` 비교로는 구분 불가 — `local-store-lock.ts` catch 주석에 근거 있음.
- **`ceal-npm-release` 환경에 변수가 하나도 없다** → bare `v*` 태그를 밀면 첫 게이트에서 거절되며
  버전만 태운다. 이 레인은 bare `v*`를 밀지 않으므로 차단은 아니다.
- **frozen 사본 sync는 리포 분리 완료까지 대기**(운영자 판단, 2026-07-27). `cealctl-guide`와
  `ceal-guide`의 SKILL.md 중복(0.95)도 같은 이유로 `Deferred`.
- 나머지(drop count 하한, 관측기 HTML 소스 형태 검사, PLAUSIBLE 둘)는 품질 리뷰가 소유한다.


## References

- [품질 리뷰 2026-07-27 3차 — 현재 기준선](../charness-artifacts/quality/latest.md)
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md) ·
  [운영자 수용 천장](operator-acceptance.md)
- `vinc` 대기 요청: [`cealctl` 락 복구 불능 둘](requests/2026-07-27-to-gateway-lane-cealctl-lock-recovery.md) ·
  [아티팩트 정체성](requests/2026-07-27-to-gateway-lane-protocol-artifact-identity.md) ·
  [버전 정체성](requests/2026-07-27-to-gateway-lane-protocol-version-identity.md) ·
  [기존 넷](requests/2026-07-27-to-gateway-lane.md) ·
  [막힘 판단](requests/2026-07-27-narnia-blocked-assessment.md) ·
  [공지 준비](requests/2026-07-27-to-gateway-lane-announcement-readiness.md)
