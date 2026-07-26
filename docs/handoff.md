# Session Handoff
Date: 2026-07-27 — `main`은 `68bd2cf`, unreleased 16커밋(`git log --oneline ceal-v0.65.10..main`).
Narnia 소유 작업만 (`@corca-ai/ceal`, `ceal` 워커, `skills/ceal-guide`, `ceal-agent`).

## Workflow Trigger

- 이 파일만 언급되면 **Next Session을 번호 순서대로**. 1번 전에 실세션 생사를 확인한다:
  `ceal capabilities --fresh` — `read_only`이고 캐시를 우회해 Gateway에 실제 왕복한다.
  `npm run probe`는 **쓰지 말 것**(throwaway `HOME`이라 실세션을 답할 수 없다).
- `host_decision: accepted`면 1번부터. 아니면 1번을 **Gateway 대기로 열어둔 채** 2번으로 가고,
  대기 사유를 다음 baton에 남긴다 — **narnia는 prod를 복구할 수 없다**.
- **4번은 1·2·3번이 모두 끝난 뒤에만.** dev 재등록이 prod 바인딩을 파괴하고, 복구하려면
  `AGENTS.md ## Release And Enrollment Lanes`의 재등록 절차를 처음부터 다시 밟아야 한다.
- 스킬: 1번은 라이브 readback 후 이슈 close, 2·3번은 `charness:impl`, 4번은 declared-effect 프로브.
  로컬 커밋은 진행하며, push·tag·GitHub write·Gateway write는 매번 따로 승인.

## Continuation Capability

증명만 남은 이슈 셋, vinc 응답을 기다리는 교차 저장소 둘, 릴리스가 안고 있는 breaking 둘.

## Current State

- **설치본은 `ceal 0.65.9`**(`ceal version`, 2026-07-27). `0.65.10`은 존재하지만 아래 관측은 전부
  `0.65.9`에서 나왔다 — 1번을 어느 바이너리로 증명할지 먼저 정할 것.
- **prod 세션은 살아 있다**(2026-07-27T21:15–21:21Z). `host_decision: accepted`,
  `instance:ceal-prod`, protocol 1.3.0. access token은 정확히 15분이고 **renewal이 작동한다**
  (만료 71초 뒤 read_only 라우트 성공 + 자동 갱신). 이전 baton의 `invalid_response` 저하는
  **재현되지 않았다**. 미검증은 `enrollments create` → `request_denied` 하나뿐(write라 미실행).
- **열린 이슈 4개**(`#2`·`#3`·`#4`·`#6`) + **`ceal-agent#2`**. `#2`·`#3`·`#4`는 코드가 이미
  `0.65.9`에 있고 **증명만 남았다**. `ceal guide status`는 라이브로 `agent: claude`를 옳게 답한다.
- **`ceal-agent#2`는 narnia 몫이 끝났다** — `corca-ai/ceal-agent@474ac96`(record + 검증기 + 16테스트,
  `npm run check` 35 통과, push 완료). **남은 둘은 vinc 소유**: `corca-ai/ceal`의
  `scripts/verify-ceal-agent-public-closure.mjs` digest 리터럴 제거와 source map 등록.
  **`~/codes/ceal`에서 그 파일을 고치지 말 것 — 요청만 한다.**
- **Gateway 레인 전달 노트 2건**(`oc:~/ceal` 신규 untracked; 그 체크아웃의 다른 것은 편집·stage·
  commit·clean·rebase 전부 금지 — `AGENTS.md ## Host And Lane`):
  `…-agent-artifact-binding.md`(리터럴 제거 요청), `…-prod-session-and-protocol-consumer.md`
  (위 prod 관측 + `#6` 요구 + dev 인스턴스 이름 요청).
- **`@corca-ai/ceal-protocol@0.65.0`은 바이트가 세 벌**(버전 미범프 재빌드). digest만 핀하면 계속
  깨지니 새로 핀할 땐 producing commit+tree에 묶을 것. 전체 값은 `ceal-agent`의
  `gateway-artifact-handoff.json`이 소유하며, 그 파일 밖의 축약형은 **식별용이지 핀 값이 아니다**.
- **`#6`은 forward 절반이 끝나 있다** — `verify-gateway-protocol-consumer.mjs`는 digest를
  하드코딩하지 않고 provenance 자기정합성만 본다. ledger의
  `clean_ceal_cli_worker_packed_gateway_protocol`은 **resolved**. 남은 구멍은
  `gateway_protocol_source.rollback_proof`(pending) + 기존 증거가 worker `0e1b256f` 기준이라 낡음.

## Next Session

1. **`#2`·`#3`·`#4`를 released-binary 증명으로 닫는다.** 살아 있는 prod 세션에 매트릭스를 재실행하고
   **관측한 것**만 인용한다. 아직 라이브로 안 돈 것: `#3`의 `--profile` override, `#4`의 미등록
   advisory 경로.
2. **`#6`의 rollback rehearsal.** vinc가 packed 아티팩트+provenance를 주면
   `verify-gateway-protocol-consumer.mjs`를 현재 main 기준으로 재실행해 새 proof를 남기고, rollback
   pair를 producing commit+tree에 묶어 리허설한다 → ledger의 pending이 풀린다.
3. **publish 워크플로가 일시적 readback 실패로 태그를 태우지 않게 한다.** 대상은
   `.github/workflows/ceal-release.yml`. `cealctl-release.yml`은 **frozen이니 건드리지 말 것**
   (`AGENTS.md ## Frozen Paths`). `0.65.8`이 그렇게 죽었다.
4. **`corca-ai/ceal#633` 프로브 마무리 — 반드시 마지막.** dev 인스턴스 이름과 Gateway 재시작 둘 다
   vinc 몫이라 요청해 뒀다. 남은 프로브: 재시작 후 cursor 생존, `message_ref` TTL 만료,
   `since`/`until` 경계 페이지.

vinc가 client digest의 producing commit을 주면 `ceal-agent#2`의 rollback을 리허설해 닫을 수 있다.

## Discuss

- **breaking 둘을 한 번에 announce할지.** `a268e8e`(`error.code` 제거)·`c5bc9b7`(`hosts`만이 per-host
  답) 모두 reader를 깬다. alias 없는 clean break은 택했고, 남은 결정은 묶어 낼지다. 릴리스가 여기 막혔다.
- **frozen 사본 sync 방식.** `scripts/build-platform-binaries.mjs`는 `AGENTS.md ## Frozen Paths`가
  frozen으로 선언했고 `corca-ai/ceal`의 `packaging/ceal-cli-source/`에 미러가 있다. 그 sync가 새
  `scripts/lib/`를 옮기는지 몰라 막혀 있다 — 소유자 확정 전엔 양쪽 다 편집 금지.
- **`AGENTS.md`의 내부 호스트명**(`narnia`/`vinc`/`ssh oc`/`~/codes/...`)을 공개 전에 정리할지.

## References

- [품질 리뷰 — `## Weak`·`## Advisory`만 유효](../charness-artifacts/quality/latest.md)
- [Issue #1 resolution critique](../charness-artifacts/critique/2026-07-25-issue-1-leaf-help-resolution.md)
