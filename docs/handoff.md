# Session Handoff
Date: 2026-07-27 — 이전 Next Session **2·3·4번은 끝났고**, 1번만 `vinc` 대기로 남았다.
로컬 커밋 5개가 push 대기다(`24e4d94`, `efc986b`, `4353e26`, `d47c0e5`, `a30e49d`,
그리고 문서 커밋). **이 레인은 `corca-ai/ceal-cli`만 다룬다**(`ceal-agent`는 `vinc` 소유).

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
- **게이트 측정치** (2026-07-27 narnia): `npm run check` 1:36.63, 통과 **366**개.
  `check:unit` 22.95s, 통과 **320**개. 이전 baton의 `310`은 `check:unit` 쪽 수치였고
  풀 게이트 수와 섞여 있었다 — 두 수를 분리해 적는다. 문서의 수치를 인용하지 말고 손에 있는
  호스트에서 재는 게 규칙이다(`AGENTS.md ## Gates`).
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
2. **품질 리뷰 재실행.** 오늘 세 슬라이스가 랜딩했고 `latest.md`는 그 이전 기준선이다.
   `AGENTS.md` 재구성으로 truth surface도 둘 늘었다. 새로 볼 것 하나가 이미 있다 —
   `local-store-guards.ts:64-70`의 `existsSync` → `mkdirSync` TOCTOU: 두 프로세스가 **없는**
   `~/.ceal`을 동시에 만들면 진 쪽이 `EEXIST`를 `unsafe_store`로 오분류한다. 오늘 리뷰가
   PLAUSIBLE로 올렸고, 실제 도달 시나리오를 구성하지 못했다(enrollment가 먼저 디렉터리를
   만든다). 선행 결함이지 오늘 슬라이스의 결함이 아니다.
3. **`corca-ai/ceal#633` 프로브 마무리 — 반드시 마지막.** dev 인스턴스 이름과 Gateway 재시작
   둘 다 `vinc` 몫이라 요청해 뒀다. 남은 프로브: 재시작 후 cursor 생존, `message_ref` TTL 만료,
   `since`/`until` 경계 페이지.

## Debt

- **spool 영수증 손실은 좁혀졌을 뿐 닫히지 않았다.** `receipt-spool.ts`의 락은 5초 내
  경합만 막고, 넘어가면 `spool_busy`가 조용히 삼켜져 영수증이 사라진다 — **몇 번 사라졌는지
  세는 곳이 없다**. 닫으려면 observer가 렌더할 수 있는 durable drop counter가 필요하다.
- **frozen 사본 sync는 리포 분리 완료까지 대기.** `corca-ai/ceal`의 `packaging/ceal-cli-source/`
  미러가 `guide-contract.test.mjs`의 `test/contract/` 이동과 새 `scripts/lib/`를 모르지만,
  기계적으로 깨지는 건 없고 분리가 끝나면 미러 자체가 사라진다. sync 규칙을 만드는 건 곧
  없어질 것에 대한 투자라 **하지 않기로 했다**(운영자 판단, 2026-07-27).
- **락의 stale-owner 경로는 테스트가 없다.** `local-store-lock.ts`의 stale 회수, 1초
  initialization grace, busy deadline, unsafe-lock-directory 거부는 추출 전후 모두 커버리지 0이다.
  추출이 무동작이라는 근거는 `HEAD` 대비 diff(확인함)이지 게이트가 아니다.

## References

- [Gateway 레인 전달 프롬프트](requests/2026-07-27-to-gateway-lane.md)
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md)
- [품질 리뷰 2026-07-27 — 상위 3건은 처리됨](../charness-artifacts/quality/latest.md)
