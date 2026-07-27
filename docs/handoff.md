# Session Handoff
Date: 2026-07-27 — 이전 Next Session **2·3·4번과 그 부채 셋까지 끝났고**, 1번만 `vinc`
대기로 남았다. 로컬 커밋 7개가 push 대기다(`24e4d94` → `a598ad3`).
**이 레인은 `corca-ai/ceal-cli`만 다룬다**(`ceal-agent`는 `vinc` 소유).

## Workflow Trigger

- 이 파일만 언급되면 **Next Session을 번호 순서대로**.
- 세션 도중 prod 세션 생사가 필요하면 `ceal capabilities --fresh` — `read_only`이고 캐시를
  우회해 실제 왕복한다. `npm run probe`는 **쓰지 말 것**(throwaway `HOME`이라 실세션을 답할 수 없다).
- **3번은 1·2번이 끝난 뒤에만.** dev 재등록이 prod 바인딩을 파괴하고, 복구하려면
  `docs/release-and-enrollment.md`의 재등록 절차를 처음부터 다시 밟아야 한다.
- 스킬: 1번은 `charness:impl`, 2번은 `charness:quality`, 3번은 declared-effect 프로브.
  로컬 커밋은 진행하며, push·tag·GitHub write·Gateway write는 매번 따로 승인.
  **subagent는 승인 없이 띄운다**(`AGENTS.md ## Boundaries`).

## Continuation Capability

열린 이슈 하나(`vinc` 대기)와 프로브 하나. 오늘 확인된 제품 결함과 게이트 구멍은 전부 닫혔고,
`vinc`에 걸린 요청은 넷으로 늘었다.

## Current State

- **열린 이슈는 `#6` 하나**이고 **완전히 `vinc` 대기**다. `#2`·`#3`·`#4`는 released-binary
  관측으로 close. forward 절반은 끝나 있다 — `verify-gateway-protocol-consumer.mjs`는
  digest를 하드코딩하지 않고 provenance 자기정합성만 보며, ledger의
  `clean_ceal_cli_worker_packed_gateway_protocol`은 **resolved**. 남은 구멍은
  `rollback_proof`(pending) + 증거가 worker `0e1b256f` 기준이라 낡은 것.
- **`vinc`에 요청 넷이 걸려 있고 미착수다.** 프롬프트는
  [`docs/requests/2026-07-27-to-gateway-lane.md`](requests/2026-07-27-to-gateway-lane.md)가
  소유하며 운영자가 직접 넣는다. 오늘 넷째가 추가됐다(`operator-cli.test.mjs`의 `../src`
  스윕 둘 — frozen이라 여기서 못 고치는데 `check:unit`이 그걸 돌린다). 근거 노트 2건은
  `oc:~/ceal` 최상위 untracked로 전달됨 — 그 체크아웃의 다른 것은 편집·stage·commit·clean·
  rebase **전부 금지**.
- **`prod` 세션은 살아 있다**(2026-07-27T21:15–21:21Z). access token 15분, renewal 작동.
  미검증은 `enrollments create` → `request_denied` 하나뿐(write라 미실행).
- **품질 리뷰 기준선**은 [`charness-artifacts/quality/latest.md`](../charness-artifacts/quality/latest.md)
  (2026-07-27). 그 문서의 `## Recommended Next Quality Moves` 상위 세 개는 오늘 전부 닫혔으므로,
  **다음에 그 문서를 읽을 땐 이미 처리된 항목으로 취급할 것** — 리뷰 자체는 재실행되지 않았다.
- **게이트 측정치** (2026-07-27 narnia): `npm run check` 1:38.70, 통과 **382**개.
  `check:unit` 통과 **336**개. 이전 baton의 `310`은 `check:unit` 쪽 수치였고 풀 게이트 수와
  섞여 있었다 — 두 수를 분리해 적는다. 문서의 수치를 인용하지 말고 손에 있는 호스트에서 재는
  게 규칙이다(`AGENTS.md ## Gates`).
- **`@corca-ai/ceal-protocol@0.65.0`은 바이트가 세 벌**(버전 미범프 재빌드). 새로 핀할 땐
  producing commit+tree에 묶을 것. 전체 값은 위 프롬프트 문서가 표로 들고 있다.
- **`AGENTS.md`가 187 → 125줄로 재구성됐다.** 설명은 [`docs/gates.md`](gates.md)와
  [`docs/release-and-enrollment.md`](release-and-enrollment.md)로 내려갔고 규칙만 남았다.
  90줄까지는 못 줄였고, 더 줄이면 규칙이 깎이므로 여기서 멈춘 것이다.

## Next Session

1. **`#6`의 rollback rehearsal — `vinc` 대기.** `vinc`가 2026-07-27에 선행 병목을 풀었다
   (`65c7fabf1`, 고정 SHA 대신 clean `ceal-agent` 수용 기록을 엄격 검증 + fail-closed fence).
   다만 **packed 아티팩트+provenance 전달은 아직 아니고**, legacy public-closure는 별개 부채로
   여전히 멈춘다: `ceal-agent` 최신화로 target과 legacy compatibility projection 사이 6개 파일이
   어긋났다. 실패 사유가 "사라진 고정 SHA"에서 "Agent 수용 record와 과거 proof 불일치"로
   **바뀐 것**이 진척이다. 받으면 `verify-gateway-protocol-consumer.mjs`를 현재 `main` 기준으로
   재실행해 새 proof를 남기고, rollback pair를 producing commit+tree에 묶어 리허설한다.
2. **품질 리뷰 재실행.** 오늘 네 슬라이스가 랜딩했고 `latest.md`는 그 이전 기준선이다.
   `AGENTS.md` 재구성으로 truth surface도 둘 늘었다. TOCTOU 항목은 **닫혔다** — 리뷰가
   PLAUSIBLE로 올렸던 것을 6-프로세스 경합 테스트로 재현했고 pre-fix 코드가 20회 중 20회
   실패했다.
3. **`corca-ai/ceal#633` 프로브 마무리 — 반드시 마지막.** dev 인스턴스 이름과 Gateway 재시작
   둘 다 `vinc` 몫이라 요청해 뒀다. 남은 프로브: 재시작 후 cursor 생존, `message_ref` TTL 만료,
   `since`/`until` 경계 페이지.

## Debt

- **drop count는 언제나 하한이지 총계가 아니다.** 프로세스가 살아남아 세었을 때만 계수된다 —
  SIGKILL, `HOME` 미설정, 카운터 자체의 실패는 전부 세어지지 않는다. `dropped_appends_are_a_floor`가
  이걸 페이로드에 명시한다. 더 좁히려면 append를 await하거나 종료 훅이 필요한데, 둘 다 호출
  결과를 지연시키므로 spool의 기본 규칙과 충돌한다.
- **관측기 HTML 검사는 소스 형태 검사다.** 페이지가 클라이언트 렌더인데 게이트에 DOM이 없다.
  분기 **삭제**는 잡고(probe로 확인) **무력화**(`if (false)`)는 못 잡는다 — 죽은 분기에도 식별자가
  남기 때문. 닫으려면 게이트에 DOM을 들여야 하고 그건 이 슬라이스보다 큰 작업이다.
- **frozen 사본 sync는 리포 분리 완료까지 대기.** `packaging/ceal-cli-source/` 미러가
  `guide-contract.test.mjs` 이동과 새 `scripts/lib/`를 모르지만, 기계적으로 깨지는 건 없고
  분리가 끝나면 미러 자체가 사라진다. sync 규칙 설계는 **하지 않기로 했다**(운영자 판단, 2026-07-27).
- **미해결 PLAUSIBLE 둘** (2026-07-27 리뷰, 재현 시나리오 미구성):
  `recordDrop`의 cap 검사는 N개 프로세스가 동시에 통과해 최대 N-1바이트 초과 가능(계수는
  여전히 유계라 표시상 불일치뿐). `prepareDirectory`의 `mkdir` 오류 순서가 macOS/BSD에서
  Linux와 같은지는 mac 러너에서만 확인 가능 — 다르면 쓰기 불가 부모에서 `unsafe_store`가
  더 일찍 난다.

## References

- [Gateway 레인 전달 프롬프트](requests/2026-07-27-to-gateway-lane.md)
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md)
- [품질 리뷰 2026-07-27 — 상위 3건은 처리됨](../charness-artifacts/quality/latest.md)
