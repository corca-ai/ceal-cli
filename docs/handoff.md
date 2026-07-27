# Session Handoff
Date: 2026-07-27 — `ceal-v0.66.1` released and installed, `main`은 `a519a5e`, unreleased 0커밋.
**이 레인은 이제 `corca-ai/ceal-cli`만 다룬다** (`ceal-agent`는 2026-07-27부로 `vinc` 소유).

## Workflow Trigger

- 이 파일만 언급되면 **Next Session을 번호 순서대로**. 1번 전에 실세션 생사를 확인한다:
  `ceal capabilities --fresh` — `read_only`이고 캐시를 우회해 Gateway에 실제 왕복한다.
  `npm run probe`는 **쓰지 말 것**(throwaway `HOME`이라 실세션을 답할 수 없다).
- 1번은 `vinc` 응답이 있어야 시작된다. 응답 전이면 2번부터 하고, 대기 사유를 다음 baton에 남긴다.
- **3번은 1·2번이 끝난 뒤에만.** dev 재등록이 prod 바인딩을 파괴하고, 복구하려면
  `AGENTS.md ## Release And Enrollment Lanes`의 재등록 절차를 처음부터 다시 밟아야 한다.
- 스킬: 1번은 `charness:impl`, 2번은 `charness:quality`, 3번은 declared-effect 프로브.
  로컬 커밋은 진행하며, push·tag·GitHub write·Gateway write는 매번 따로 승인.

## Continuation Capability

열린 이슈 하나(교차 저장소), 갓 나온 릴리스, 그리고 `vinc`에 걸린 요청 셋.

## Current State

- **`ceal-v0.66.1` released, 이 호스트에 설치됨**(`0.65.9` → `0.66.1`, `ceal update`로 확인).
  breaking 둘 다 라이브 readback 완료: `error.code` 제거(`kind`만, alias 없음), guide 문서가
  `hosts`로만 per-host를 답함. `ok`가 단일 성공 술어이고 `status`는 표면별 서술로 남긴 게
  의도된 결론이다.
- **`ceal-v0.66.0`은 소각됨**(never published). macOS 빌드가 `Build and test source`에서 죽었고
  `assemble`·`sign-and-publish`는 돌지 않아 업로드·서명 없음. 원인은 제품이 아니라 픽스처 —
  macOS의 `tmpdir()`이 `/var/folders`(→`/private/var`) 아래라, 심링크 성분을 거부하는 가드가
  자기 픽스처를 거부했다. 사유는 `CHANGELOG.md`가 소유.
- **열린 이슈는 `#6` 하나**(교차 저장소). `#2`·`#3`·`#4`는 released-binary 관측으로 close.
  `#6`의 forward 절반은 이미 끝나 있다 — `verify-gateway-protocol-consumer.mjs`는 digest를
  하드코딩하지 않고 provenance 자기정합성만 보며, ledger의
  `clean_ceal_cli_worker_packed_gateway_protocol`은 **resolved**. 남은 구멍은
  `rollback_proof`(pending) + 기존 증거가 worker `0e1b256f` 기준이라 낡은 것.
- **`vinc`에 걸린 요청 셋**(`oc:~/ceal` 신규 untracked 노트 2건으로 전달; 그 체크아웃의 다른
  것은 편집·stage·commit·clean·rebase 전부 금지 — `AGENTS.md ## Host And Lane`):
  (a) `ceal-agent`의 digest 리터럴 제거 + source map 등록, (b) `#6`용 packed 아티팩트와
  provenance를 지정 커밋에서, (c) rollback 대상 client digest의 producing commit+tree.
  (a)는 이제 `ceal-agent`가 `vinc` 소유가 되어 온전히 저쪽 일이다.
- **`prod` 세션은 살아 있다**(2026-07-27T21:15–21:21Z). access token 15분, **renewal 작동**
  (만료 71초 뒤 read_only 성공 + 자동 갱신). 이전 baton의 `invalid_response` 저하는 재현되지
  않았고 그 관측을 `vinc`에 전달했다. 미검증은 `enrollments create` → `request_denied` 하나뿐.
- **`@corca-ai/ceal-protocol@0.65.0`은 바이트가 세 벌**(버전 미범프 재빌드). 새로 핀할 땐
  producing commit+tree에 묶을 것. 전체 값은 `ceal-agent`의 `gateway-artifact-handoff.json`이
  소유하고, 그 밖의 축약형은 **식별용이지 핀 값이 아니다**.

## Next Session

1. **`#6`의 rollback rehearsal.** `vinc`가 packed 아티팩트+provenance를 주면
   `verify-gateway-protocol-consumer.mjs`를 현재 main 기준으로 재실행해 새 proof를 남기고,
   rollback pair를 producing commit+tree에 묶어 리허설한다 → ledger의 pending이 풀린다.
2. **코드 품질 계속** — `charness-artifacts/quality/latest.md`의 `## Weak`·`## Advisory`만
   유효하다(나머지 섹션과 모든 줄번호 인용은 낡았으니 다시 grep할 것). 오늘 landed된 것:
   호스트 루트 공유, 플랫폼 증명 declared-skip, 버전 파생, 릴리스 readback 재시도, macOS 게이트.
3. **`corca-ai/ceal#633` 프로브 마무리 — 반드시 마지막.** dev 인스턴스 이름과 Gateway 재시작
   둘 다 `vinc` 몫이라 요청해 뒀다. 남은 프로브: 재시작 후 cursor 생존, `message_ref` TTL 만료,
   `since`/`until` 경계 페이지.

## Discuss

- **frozen 사본 sync 방식.** `scripts/build-platform-binaries.mjs`는 frozen이고 `corca-ai/ceal`의
  `packaging/ceal-cli-source/`에 미러가 있는데, 그 sync가 새 `scripts/lib/`를 옮기는지 몰라 막혀
  있다 — 소유자 확정 전엔 양쪽 다 편집 금지.
- **`AGENTS.md`의 내부 호스트명**을 공개 전에 정리할지.

## References

- [품질 리뷰 — `## Weak`·`## Advisory`만 유효](../charness-artifacts/quality/latest.md)
