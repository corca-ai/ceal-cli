# Session Handoff
Date: 2026-07-27 — `ceal-v0.66.1` 발행·설치 완료, `main`은 `1cf89ab`, unreleased 0커밋.
**이 레인은 `corca-ai/ceal-cli`만 다룬다** (`ceal-agent`는 2026-07-27부로 `vinc` 소유).

## Workflow Trigger

- 이 파일만 언급되면 **Next Session을 번호 순서대로**. 1·2·3번은 `vinc` 응답 없이 진행되고,
  4번만 대기 항목이다.
- 세션 도중 prod 세션 생사가 필요하면 `ceal capabilities --fresh` — `read_only`이고 캐시를
  우회해 실제 왕복한다. `npm run probe`는 **쓰지 말 것**(throwaway `HOME`이라 실세션을 답할 수 없다).
- **5번은 1~4번이 끝난 뒤에만.** dev 재등록이 prod 바인딩을 파괴하고, 복구하려면
  `AGENTS.md ## Release And Enrollment Lanes`의 재등록 절차를 처음부터 다시 밟아야 한다.
- 스킬: 1·2번은 `charness:impl`, 3번은 `charness:quality`, 4번은 `charness:impl`,
  5번은 declared-effect 프로브. 로컬 커밋은 진행하며,
  push·tag·GitHub write·Gateway write는 매번 따로 승인.

## Continuation Capability

열린 이슈 하나(전부 `vinc` 대기), 확인된 제품 정확성 결함 하나, 낡은 품질 기준선.

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
- **품질 아티팩트가 낡았다.** `## Weak`·`## Advisory`의 여러 항목이 오늘 해소됐고(실바이너리
  조용한 skip, `AGENTS.md`의 `CEALCTL_SUBCOMMANDS` 오지목), 남은 항목의 줄번호는 안 맞는다.
  하나는 그 이름으로 **찾지도 못했다**(`cli.test.mjs:1650` 런타임 순수성 denylist).
  줄번호를 쫓지 말고 3번에서 다시 돌릴 것.
- **`@corca-ai/ceal-protocol@0.65.0`은 바이트가 세 벌**(버전 미범프 재빌드). 새로 핀할 땐
  producing commit+tree에 묶을 것. 전체 값은 위 프롬프트 문서가 표로 들고 있다.

## Next Session

1. **표 기반 디스패치 — 유일한 제품 정확성 결함.** `AGENTS.md ## Gates`가 경고만 하고 동작은
   그대로다: `runSession`은 non-`logout` 세션 라우트를 전부 enrollment로, `runGuide`는
   non-`register` guide 라우트를 전부 status로 떨군다. 테이블에만 행을 추가하면 `check:unit`
   (help·거부 게이트)은 통과하고 **배포된 바이너리에서 오라우팅된다**. 디스패치를 테이블에서
   유도하거나, 테이블 행과 러너 분기의 불일치를 게이트로 잡을 것.
2. **싼 것 둘 묶기.** (a) `test/guide-contract.test.mjs`를 `test/contract/`로 — 릴리스
   아티팩트가 필요 없는데 `--test-concurrency=1` 세금 ~8초를 낸다. (b)
   `test/gateway-protocol-fixture.mjs:8`의 `new URL(...).pathname` → `fileURLToPath`;
   체크아웃 경로에 공백이 있으면 혼란스러운 ENOENT가 난다.
3. **품질 리뷰 재실행**(`charness:quality`). 오늘 린터·브랜치 CI·pre-push 훅·macOS 매트릭스·
   버전 파생·릴리스 readback 재시도가 전부 landed되어 기준선 자체가 달라졌다. 1·2번이 끝난
   뒤에 돌려야 결과가 정확하다.
4. **`#6`의 rollback rehearsal — `vinc` 응답 후.** packed 아티팩트+provenance를 받으면
   `verify-gateway-protocol-consumer.mjs`를 현재 `main` 기준으로 재실행해 새 proof를 남기고,
   rollback pair를 producing commit+tree에 묶어 리허설한다 → ledger의 pending이 풀린다.
5. **`corca-ai/ceal#633` 프로브 마무리 — 반드시 마지막.** dev 인스턴스 이름과 Gateway 재시작
   둘 다 `vinc` 몫이라 요청해 뒀다. 남은 프로브: 재시작 후 cursor 생존, `message_ref` TTL 만료,
   `since`/`until` 경계 페이지.

## Discuss

- **frozen 사본 sync 방식.** `scripts/build-platform-binaries.mjs`는 frozen이고 `corca-ai/ceal`의
  `packaging/ceal-cli-source/`에 미러가 있는데, 그 sync가 새 `scripts/lib/`를 옮기는지 몰라 막혀
  있다 — 소유자 확정 전엔 양쪽 다 편집 금지.
- **`AGENTS.md`의 내부 호스트명**을 공개 전에 정리할지.

## References

- [Gateway 레인 전달 프롬프트](requests/2026-07-27-to-gateway-lane.md)
- [품질 리뷰 — 3번에서 재실행 전까지만 참고](../charness-artifacts/quality/latest.md)
