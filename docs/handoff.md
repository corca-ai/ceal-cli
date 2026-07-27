# Session Handoff
Date: 2026-07-27 — `ceal-v0.66.1` 발행·설치 완료. 이전 1·2·3번은 **끝났고** 로컬 커밋 2개가
push 대기다(`24e4d94` + 품질 슬라이스). **이 레인은 `corca-ai/ceal-cli`만 다룬다**
(`ceal-agent`는 2026-07-27부로 `vinc` 소유).

## Workflow Trigger

- 이 파일만 언급되면 **Next Session을 번호 순서대로**. 1번은 `vinc` 대기,
  2~5번은 대기 없이 진행된다.
- 세션 도중 prod 세션 생사가 필요하면 `ceal capabilities --fresh` — `read_only`이고 캐시를
  우회해 실제 왕복한다. `npm run probe`는 **쓰지 말 것**(throwaway `HOME`이라 실세션을 답할 수 없다).
- **5번은 2~4번이 끝난 뒤에만.** dev 재등록이 prod 바인딩을 파괴하고, 복구하려면
  `AGENTS.md ## Release And Enrollment Lanes`의 재등록 절차를 처음부터 다시 밟아야 한다.
- 스킬: 1번은 `charness:impl`, 2·3번은 `charness:impl`, 4번은 `charness:issue`,
  5번은 declared-effect 프로브. 로컬 커밋은 진행하며,
  push·tag·GitHub write·Gateway write는 매번 따로 승인.

## Continuation Capability

열린 이슈 하나(`vinc` 대기), 그리고 오늘 품질 리뷰가 새로 확인한 게이트·커버리지 구멍 몇 개.
제품 정확성 결함(표 기반 디스패치)과 낡은 품질 기준선은 해소됐다.

## Current State

- **열린 이슈는 `#6` 하나**이고 **완전히 `vinc` 대기**다. `#2`·`#3`·`#4`는 released-binary
  관측으로 close. forward 절반은 이미 끝나 있다 — `verify-gateway-protocol-consumer.mjs`는
  digest를 하드코딩하지 않고 provenance 자기정합성만 보며, ledger의
  `clean_ceal_cli_worker_packed_gateway_protocol`은 **resolved**. 남은 구멍은
  `rollback_proof`(pending) + 증거가 worker `0e1b256f` 기준이라 낡은 것.
- **`vinc`에 요청 셋이 걸려 있고 미착수다**(2026-07-27 `~/codes/ceal` pull로 확인: 새 커밋
  하나뿐이고 무관, digest 리터럴 그대로, ledger stage 2 `in_progress` 그대로).
  프롬프트는 [`docs/requests/2026-07-27-to-gateway-lane.md`](requests/2026-07-27-to-gateway-lane.md)가
  소유하며 운영자가 직접 넣는다. 근거 노트 2건은 `oc:~/ceal` 최상위 untracked로 이미 전달됨 —
  그 체크아웃의 다른 것은 편집·stage·commit·clean·rebase **전부 금지**(`AGENTS.md ## Host And Lane`).
  `vinc`의 새 apply 절차가 그 untracked 노트를 보존한다고 명시하므로 채널은 안전하다.
- **`prod` 세션은 살아 있다**(2026-07-27T21:15–21:21Z). access token 15분, **renewal 작동**
  (만료 71초 뒤 read_only 성공 + 자동 갱신). 이전 baton의 `invalid_response` 저하는 재현되지
  않았고 `vinc`에 전달했다. 미검증은 `enrollments create` → `request_denied` 하나뿐(write라 미실행).
- **품질 리뷰는 오늘 재실행했다** → [`charness-artifacts/quality/latest.md`](../charness-artifacts/quality/latest.md)
  (2026-07-27, 검증 통과). 이전 `## Weak` 전부 해소 또는 재분류됐다. 이전 baton이 못 찾은
  `cli.test.mjs:1650` 런타임 순수성 denylist는 **트리 어디에도 없다** — 그 항목은 폐기.
  `npm run check` 1:40.16 / `check:unit` 22.93s (오늘 narnia 측정, 310 테스트).
- **게이트 자체가 조용히 통과하던 케이스 셋을 오늘 막았다**: 워크플로 SHA 핀은 이 레인이
  편집하는 세 워크플로를 전혀 안 봤고, prewarm 순서 테스트는 게이트 스텝을 못 찾으면
  `continue`로 무효화됐고, `cli.test.mjs`의 `../src` 스윕 둘은 non-recursive에 `error: {`
  정규식이 템플릿 보간의 첫 `}`에서 잘렸다. 전부 negative probe로 확인 후 수정.
- **`@corca-ai/ceal-protocol@0.65.0`은 바이트가 세 벌**(버전 미범프 재빌드). 새로 핀할 땐
  producing commit+tree에 묶을 것. 전체 값은 위 프롬프트 문서가 표로 들고 있다.

## Next Session

1. **`#6`의 rollback rehearsal — `vinc` 대기.** `vinc`가 2026-07-27에 선행 병목을 풀었다고
   전해 왔다(`65c7fabf1`, 고정 SHA 대신 clean `ceal-agent` 수용 기록을 엄격 검증 + fail-closed
   fence). 다만 **packed 아티팩트+provenance 전달은 아직 아니고**, legacy public-closure는
   별개 부채로 여전히 멈춘다: `ceal-agent` 최신화로 target과 legacy compatibility projection
   사이 6개 파일이 어긋났다. 실패 사유가 "사라진 고정 SHA"에서 "Agent 수용 record와 과거 proof
   불일치"로 **바뀐 것**이 진척이다. 받으면 `verify-gateway-protocol-consumer.mjs`를 현재
   `main` 기준으로 재실행해 새 proof를 남기고, rollback pair를 producing commit+tree에 묶어
   리허설한다 → ledger의 pending이 풀린다.
2. **spool append 경합 — 확인된 제품 결함.** `receipt-spool.ts:115-135` `appendEntry`가 락 없는
   read-modify-write다. `profile-store.ts:115-139`에는 같은 파일군용 락이 이미 있다. `ceal call`
   두 프로세스가 동시에 append하면 손상은 없지만 **영수증 하나가 조용히 사라지고**, 바로 그
   under-report가 `ceal observe`의 존재 이유다. `receipt-spool.test.mjs`는 순차 append만 해서
   실패할 수가 없다. 락 재사용 또는 write 안에서 재-read + `requestRef` union, 그리고
   `cli.test.mjs`의 refresh-lock 케이스를 본뜬 2-프로세스 테스트.
3. **게이트 구멍 셋 마무리** (`latest.md ## Recommended Next Quality Moves` 상위 세 개).
   (a) `test/contract/worker-release-assets.test.mjs:19-20`의 손복사 allowlist를
   `install-ceal.sh:176`에서 유도 — 셸 쪽에서 `darwin`을 빼도 지금은 둘 다 통과한다.
   (b) `bin.ts:87-103` 실패 envelope 테스트 — `:102`의 `process.exitCode = 3`을 지워도
   풀 게이트가 녹색이다. (c) `ceal-release.yml`·`ceal-worker-stable-rollback.yml`에
   `timeout-minutes`, 릴리스 레인에 `CEAL_REQUIRE_PLATFORM_PROOFS`. **워크플로 편집은
   릴리스 레인을 건드리므로 운영자 승인 후에.**
4. **`vinc`에 요청 하나 추가.** `packages/ceal-operator-cli/test/operator-cli.test.mjs:89,721`이
   오늘 이쪽에서 고친 non-recursive `../src` 스윕을 파일 수 하한도 없이 그대로 갖고 있다.
   frozen이라 여기서 고칠 수 없는데 `check:unit`이 그 스윕을 돌리니 이 레인이 헛된 확신의
   비용을 낸다. `docs/requests/`에 추가.
5. **`corca-ai/ceal#633` 프로브 마무리 — 반드시 마지막.** dev 인스턴스 이름과 Gateway 재시작
   둘 다 `vinc` 몫이라 요청해 뒀다. 남은 프로브: 재시작 후 cursor 생존, `message_ref` TTL 만료,
   `since`/`until` 경계 페이지.

## Discuss

- **frozen 사본 sync 방식.** `scripts/build-platform-binaries.mjs`는 frozen이고 `corca-ai/ceal`의
  `packaging/ceal-cli-source/`에 미러가 있는데, 그 sync가 새 `scripts/lib/`를 옮기는지 몰라 막혀
  있다 — 소유자 확정 전엔 양쪽 다 편집 금지. **오늘 건이 하나 붙었다**: `guide-contract.test.mjs`가
  `test/contract/`로 옮겨졌는데 미러는 아직 옛 경로에 들고 있다. 기계적으로 깨지는 건 없지만
  다음 sync가 이동을 알아야 하고, 모르면 파일이 두 벌 된다.
- **`AGENTS.md`의 내부 호스트명**을 공개 전에 정리할지. 길이도 같이 볼 것 — 149줄이고
  `## Gates`가 오늘 또 자랐다.

## References

- [Gateway 레인 전달 프롬프트](requests/2026-07-27-to-gateway-lane.md)
- [품질 리뷰 2026-07-27 — 현재 기준선](../charness-artifacts/quality/latest.md)
