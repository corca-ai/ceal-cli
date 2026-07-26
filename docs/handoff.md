# Session Handoff
Date: 2026-07-26 — `ceal-v0.65.10` stable, `main`에 unreleased 13커밋.
Narnia 소유 작업만 (`@corca-ai/ceal`, `ceal` 워커, `skills/ceal-guide`).

## Workflow Trigger

- 이 파일만 언급되면: **Next Session을 번호 순서대로**. 먼저 `npm run probe`로 prod 세션을
  **읽기 전용** 확인한다(저하는 미검증 상태) — 살아 있으면 1번, 아니면 2번부터.
  **narnia는 prod를 복구할 수 없다**: 복구는 Gateway 레인의 행위이고 이 레인이 할 일은
  3번(전달)뿐이다. 스킬은 항목마다 다르다 — 2·4번은 `charness:impl`, 1번은 라이브 readback
  후 이슈 close, 3번은 교차 레인 노트, 5번은 소유자 우선 교차 저장소, 6번은 declared-effect
  프로브. 로컬 커밋은 진행하며 하고, push·tag·GitHub write·Gateway write는 매번 따로 승인.
- **6번을 1번 전에 하지 말 것**: 6번은 dev 재등록이 필요하고 워커 세션은 인스턴스 하나만
  담으므로, 재등록하면 1번이 쓸 prod 바인딩이 로컬에서 파괴된다.

## Continuation Capability

증명 대기 중인 이슈, 새 게이트가 막아주는 것, 릴리스가 안고 있는 breaking 둘.

## Current State

- **열린 이슈 4개.** `#2`·`#3`·`#4`는 코드가 이미 `0.65.9`에 있고 **증명만 남았다**(1번).
  `#6`(신규·무라벨)은 Gateway 소유 protocol 아티팩트의 consumer cutover로
  `corca-ai/ceal` Stage 5 retirement를 막는 교차 저장소 항목. `#1`·`#5`는 CLOSED.
- **prod 세션 저하는 Gateway-side, 이번 세션에서 재확인 안 함** — 저하 상태라고 단정하지
  말고 먼저 확인할 것. 증상: 액세스 토큰 ~15분 만료, renewal이 `invalid_response`,
  대체 `enrollments create`가 `request_denied`인데 registry는 active로 보고. `0.65.6`
  바이너리로도 재현돼 릴리스 회귀는 아니다.
  **Gateway 레인에 전달된 적 없음**: 이전 baton이 인용한
  `oc:~/ceal/handoff-from-narnia-2026-07-26.md`가 **없다**(로컬·`ssh oc` 양쪽 확인) — 3번.
- **unreleased 13커밋 중 둘이 문서 형태 breaking**: `a268e8e`(`error.code` 제거, `kind`만),
  `c5bc9b7`(`hosts`만이 per-host 답). `0.65.10`이 같은 주에 `ceal.client_session.v1`을
  이미 깼다. 나머지 11개는 이번 세션의 품질·도구 작업.
- **게이트가 늘었다**(`AGENTS.md` `## Gates` 소유). 픽업에 필요한 건 하나: **clone마다
  `npm run hooks:install`**.
- **이 호스트는 `instance:ceal-prod`**(`client:narnia`, `profile:work`). dev에만
  `message.enumerate`(`corca-ai/ceal#633` 경로), prod에만 write 능력과 넓은 카탈로그가 있어 dev 프로브는
  의도적 재등록이 필요하다 — 절차는 `AGENTS.md` `## Release And Enrollment Lanes`가 소유.

## Next Session

1. **`#2`·`#3`·`#4`를 released-binary 증명으로 닫는다.** prod 복구 후, 설치된 `0.65.10`에
   매트릭스를 재실행하고 구현한 것이 아니라 **관측한 것**을 인용해 닫는다. 재현 대상은 각
   이슈의 `## Observed` 항목(정식 수용 기준은 없다). 아직 라이브로 한 번도 안 돈 것: `#3`의
   `--profile` override(세션 기본값이 아닌 실제 사용 profile을 따르는지), `#4`의 미등록
   advisory 경로.
2. **코드 개선 계속** — `charness-artifacts/quality/latest.md`의 `## Weak`·`## Advisory`만
   유효하다. 그 아티팩트의 `## Current Gates`·`## Missing`·`## Recommended Next Quality
   Moves`와 모든 줄번호 인용은 **이번 세션 이전**이라 낡았다(린터·브랜치 CI·pre-push 훅은
   이미 landed; 게이트의 소유자는 `AGENTS.md ## Gates`). 줄번호는 붙여넣지 말고 다시 grep할 것.
   값 순서: (a) `agent-audit.ts:20`이 `.claude`/`.codex`를 하드코딩하고 `CLAUDE_CONFIG_DIR`/
   `CODEX_HOME`을 **전혀** 안 읽는데 `observer.ts`는 그 경로를 privacy projection에서 사실로
   선언한다 — `CEAL_AGENT_GUIDE_HOSTS` 공유가 최소 수정. (b) 실바이너리·설치 증명이
   linux-x64 아닌 호스트에서 **조용히 skip**된다(arm64 macOS는 설치 증명 0으로 초록).
3. **prod 저하를 Gateway 레인에 실제로 전달한다.** 증상을 먼저 재확인해 관측한 것만,
   `oc:~/ceal`의 새 untracked 최상위 `*.md`로 남긴다 — 그 체크아웃의 다른 것은
   edit·stage·commit·clean·rebase **모두** 금지(`AGENTS.md ## Host And Lane` 소유).
4. **publish 워크플로가 일시적 readback 실패로 태그를 태우지 않게 한다** — `0.65.8`이 그렇게
   죽었고, 실패 전 재시도 몇 번이면 살았다.
5. **교차 저장소 둘, 둘 다 소유자 우선**(사본에 독립 편집 금지, 소유자 변경 후 검토된 sync).
   `corca-ai/ceal`의 extraction ledger를 먼저 읽는다. (a) `#6` consumer cutover — Gateway가
   만든 패키지 버전+digest 하나와 리허설된 rollback 쌍을 지목할 수 있게 되는 것이 목표.
   (b) `#4`가 만든 드리프트 — **`corca-ai/ceal`의 `packaging/ceal-cli-source/`** 안 사본이
   `agent`를 리터럴 `"codex"`로 타이핑하고, 거기 기록된 절차가 `guide register codex`를
   지시한다. 이 저장소의 `packages/ceal-worker-cli/src/agent-guide.ts`는 **이미 올바르고 sync
   원본**이다 — 로컬 파일을 고치려 들지 말 것.
6. **`corca-ai/ceal#633` 프로브 마무리 — 반드시 마지막.** dev 재등록이 필요해 prod 바인딩을
   파괴한다(위 Trigger). dev 인스턴스 이름은 이 baton에 없으니 Gateway 레인에서 받는다.
   Gateway 재시작은 이 레인의 행위가 아니라 Gateway 레인에 요청할 일이다. 남은 프로브:
   재시작 후 cursor 생존(표면이 스스로 `gateway_restart_stable: false` 선언), `message_ref`
   TTL 만료, `since`/`until` 경계 페이지.

릴리스는 승인 후 마무리 수순이고 **아래 첫 Discuss 항목에 막혀 있다** — 절차는 `AGENTS.md`
`## Release And Enrollment Lanes`가 소유.

## Discuss

- **breaking 둘을 한 번에 announce할지.** `a268e8e`·`c5bc9b7` 모두 reader를 깬다. alias 없는
  clean break은 이미 택했고, 남은 결정은 묶어 내보낼지다.
- **frozen 사본 sync 방식.** 최대 잔여 중복은 릴리스 스크립트 3벌(`nose query`로 측정,
  재측정 필요). `scripts/build-platform-binaries.mjs`는 로컬에서 frozen이 **아니지만**
  `corca-ai/ceal`의 frozen `packaging/ceal-cli-source/`에 미러가 있어 lockstep sync가 필요하고,
  그 sync가 새 `scripts/lib/`를 옮기는지 몰라서 막혀 있다 — 모르고 건드리면 그쪽이 깨진다.
- **`AGENTS.md`의 내부 호스트명**(`narnia`/`vinc`/`ssh oc`/`~/codes/...`)을 공개 전에
  문서에서 정리할지. force-push 정리 방침은 들었으나 문서 자체는 미결.

## References

- [품질 리뷰 — 게이트·중복·약한 증명의 소유 아티팩트](../charness-artifacts/quality/latest.md)
- [Issue #1 resolution critique](../charness-artifacts/critique/2026-07-25-issue-1-leaf-help-resolution.md)
- [Session retro — 낭비와 실제로 landed된 수정](../charness-artifacts/retro/2026-07-25-session-retro.md)
