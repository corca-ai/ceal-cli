# Session Handoff
Date: 2026-07-27 — `ceal-v0.65.10` stable, `main`에 unreleased 16커밋.
Narnia 소유 작업만 (`@corca-ai/ceal`, `ceal` 워커, `skills/ceal-guide`, `ceal-agent`).

## Workflow Trigger

- 이 파일만 언급되면: **Next Session을 번호 순서대로**. 1·2번은 prod 세션 상태에 달려 있으니
  먼저 `npm run probe`로 **읽기 전용** 확인한다 — 살아 있으면 1번, 아니면 2번부터. **narnia는
  prod를 복구할 수 없다**(복구는 Gateway 레인의 행위). 스킬은 항목마다 다르다 — 1번은 라이브
  readback 후 이슈 close, 2번은 교차 레인 노트, 3·4번은 `charness:impl`, 5번은 declared-effect
  프로브. 로컬 커밋은 진행하며 하고, push·tag·GitHub write·Gateway write는 매번 따로 승인.
- **5번을 1번 전에 하지 말 것**: dev 재등록이 1번이 쓸 prod 바인딩을 로컬에서 파괴한다.

## Continuation Capability

증명 대기 중인 이슈 셋, 다른 레인 응답을 기다리는 교차 저장소 둘, 릴리스가 안고 있는 breaking 둘.

## Current State

- **열린 이슈 4개**(`ceal-cli` `#2`·`#3`·`#4`·`#6`) + **`ceal-agent#2`**. `#2`·`#3`·`#4`는 코드가
  이미 `0.65.9`에 있고 **증명만 남았다**(1번).
- **`ceal-agent#2`는 narnia 몫이 끝났다** — `corca-ai/ceal-agent@34f1941`이
  `gateway-artifact-handoff.json`(수용 pair + provenance + 호환 범위 + rollback)과 검증기·11테스트를
  담고 `npm run check` 통과, push 완료, 이슈에 코멘트. **남은 둘은 vinc 소유**: `corca-ai/ceal`의
  `scripts/verify-ceal-agent-public-closure.mjs:42` 리터럴 제거와 source map 등록. 요청과 근거는
  `oc:~/ceal/handoff-from-narnia-2026-07-27-agent-artifact-binding.md`(신규 untracked)에 남겼다.
- **`@corca-ai/ceal-protocol@0.65.0`은 바이트가 세 벌이다** — `6d496cdb…`(`e924dfa1`),
  `ddc81502…`(`27dd2fefe`), `3e4c0296…`(`ac861859`, 2026-07-27 직접 관측). 버전 미범프 재빌드라
  digest만 핀하면 계속 깨진다. 새로 핀하는 곳은 반드시 producing commit+tree에 묶을 것.
- **`#6`은 생각보다 진척돼 있다** — 이 저장소의 `verify-gateway-protocol-consumer.mjs`는 digest를
  하드코딩하지 않고 provenance 자기정합성만 본다(이미 옳은 소비자 패턴). ledger의
  `clean_ceal_cli_worker_packed_gateway_protocol`은 **resolved**. 남은 구멍은
  `gateway_protocol_source.rollback_proof`(pending) 하나 + 기존 증거가 worker `0e1b256f` 기준이라 낡음.
- **prod 세션 저하는 이번 세션에서도 확인 안 함** — 저하 상태라고 단정하지 말 것. 증상: 토큰
  ~15분 만료, renewal `invalid_response`, `enrollments create`가 `request_denied`인데 registry는
  active. **Gateway 레인에 아직 전달 안 됨**(2번).
- **`AGENTS.md`가 낡은 곳 하나**: `oc:~/ceal`은 지금 working tree가 깨끗하다("uncommitted work를
  carry한다"는 서술이 현재는 사실이 아님). 편집 금지 규칙 자체는 유효하다.

## Next Session

1. **`#2`·`#3`·`#4`를 released-binary 증명으로 닫는다.** prod 복구 후 설치된 `0.65.10`에 매트릭스를
   재실행하고 **관측한 것**만 인용해 닫는다. 아직 라이브로 한 번도 안 돈 것: `#3`의 `--profile`
   override, `#4`의 미등록 advisory 경로.
2. **prod 저하를 Gateway 레인에 실제로 전달한다.** 증상을 먼저 재확인해 관측한 것만,
   `oc:~/ceal`의 새 untracked 최상위 `*.md`로 (그 체크아웃의 다른 것은 전부 편집 금지).
3. **`#6`의 rollback rehearsal.** 현재 Gateway 커밋에서 packed 아티팩트를 받아
   `verify-gateway-protocol-consumer.mjs`를 현재 main 기준으로 재실행해 새 proof를 남기고, rollback
   pair를 producing commit에 묶어 리허설한다. 그러면 ledger의 pending이 풀린다.
4. **publish 워크플로가 일시적 readback 실패로 태그를 태우지 않게 한다** — `0.65.8`이 그렇게 죽었다.
5. **`corca-ai/ceal#633` 프로브 마무리 — 반드시 마지막.** dev 재등록 필요(위 Trigger). dev 인스턴스
   이름은 Gateway 레인에서 받는다. 남은 프로브: 재시작 후 cursor 생존, `message_ref` TTL 만료,
   `since`/`until` 경계 페이지.

vinc 응답이 오면: `ceal-agent#2`의 rollback pair에 client digest `3d959dcb…`의 producing commit을
묶고 리허설하면 그 이슈가 닫힌다. 릴리스는 아래 첫 Discuss 항목에 막혀 있다.

## Discuss

- **breaking 둘을 한 번에 announce할지.** `a268e8e`(`error.code` 제거)·`c5bc9b7`(`hosts`만이 per-host
  답) 모두 reader를 깬다. alias 없는 clean break은 택했고, 남은 결정은 묶어 낼지다.
- **frozen 사본 sync 방식.** `scripts/build-platform-binaries.mjs`는 로컬에서 frozen이 아니지만
  `corca-ai/ceal`의 frozen `packaging/ceal-cli-source/`에 미러가 있어 lockstep sync가 필요하고, 그
  sync가 새 `scripts/lib/`를 옮기는지 몰라 막혀 있다.
- **`AGENTS.md`의 내부 호스트명**(`narnia`/`vinc`/`ssh oc`/`~/codes/...`)을 공개 전에 정리할지.

## References

- [품질 리뷰 — `## Weak`·`## Advisory`만 유효](../charness-artifacts/quality/latest.md)
- [Issue #1 resolution critique](../charness-artifacts/critique/2026-07-25-issue-1-leaf-help-resolution.md)
