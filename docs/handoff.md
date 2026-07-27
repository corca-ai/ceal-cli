# Session Handoff
Date: 2026-07-27 — `vinc` 대기 중 **자율 개선 한 판**을 돌렸다. 게이트가 절반 이하로
줄었고(**~98s → 44s**), 재현까지 마친 **결함 다섯**을 고쳤다. 전부 로컬 커밋 5개이고
**push는 안 했다**. push 상태는 세어서 확인할 것(`git log @{u}..HEAD`).
**이 레인은 `corca-ai/ceal-cli`만 다룬다**(`ceal-agent`는 `vinc` 소유).

## Workflow Trigger

- 이 파일만 언급되면 **Next Session을 번호 순서대로**. 1–3번은 `vinc` 응답 대기이고,
  막힘 없는 코드 일감은 4번(품질 리뷰 3차의 active 카드)이다.
- 세션 도중 prod 세션 생사가 필요하면 `ceal capabilities --fresh` — `read_only`이고 캐시를
  우회해 실제 왕복한다. `npm run probe`는 **쓰지 말 것**(throwaway `HOME`이라 실세션을 답할 수 없다).
- 로컬 커밋은 진행하며, push·tag·GitHub write·Gateway write는 매번 따로 승인.
  **subagent는 승인 없이 띄운다**(`AGENTS.md ## Boundaries`).
- 문서에 적힌 게이트 수치·push 상태·이슈 상태를 **인용하지 말고 그 자리에서 확인할 것**.
  이 baton은 그걸로 두 번 틀렸다(push 대기 커밋 수, `#633` 개폐 여부).

## Continuation Capability

막힘 없는 코드 일감이 **생겼다**. [품질 리뷰 3차](../charness-artifacts/quality/latest.md)의
`## Recommended Next Quality Moves`에 **active 셋**이 있고, 그중 둘은 이 레인 안에서 끝난다:
`ceal update`에 데드라인 주기, `createLock` 실패 정리에 소유권 검사 붙이기. 셋째(병렬 tier를
CI 러너에서 확인)는 push 후 관측이다.

## Closed This Session (2026-07-27, 자율 개선 판)

로컬 커밋 5개(`b5bd5e1..HEAD`). **전부 삭제로 falsify 확인함** — 게이트가 초록인 것은
증거로 치지 않았다.

- **게이트가 ~98s → 44s.** `test:release`의 `--test-concurrency=1`은 이유가 기록되지 않은 채
  무관한 feature 커밋에 딸려 들어왔었다. 실제 이유는 있었다: 픽스처들이 체크아웃된
  `packages/*/dist`에 `npm run build`를 쏟아붓고 같은 트리를 `npm pack`/`cpSync`로 되읽는다.
  그래서 pin을 없애는 대신 **`dist`에 주인을 줬다** — `test/repo-build.mjs`,
  `withBuiltPackages(paths, read)`.
  - **1차 시도는 틀렸고 fresh-eye 리뷰가 잡았다.** 락이 build만 덮고 read를 안 덮어서 원래
    레이스가 그대로였고, in-process memo가 그걸 더 나쁘게 만들었다. 초록 3판은 운이었다.
    지금은 락이 read까지 덮고, 워크스페이스 전체에 **락 하나**다(client의 `tsc`가 protocol의
    `dist`를 읽으므로 패키지별 락은 의미가 없다).
  - staleness는 벽시계가 아니라 **프로세스 생존**으로 판정하고(이 트리의 `local-store-lock.ts`가
    이미 내린 결론), release는 nonce를 확인한다. owner 기록 전에 죽은 홀더용 grace는
    **falsification 실행이 그 락에 걸려 멈추면서** 발견했다.
  - `guide-contract`는 동일 argv spawn 22/70을 memo (8.3s → 5.9s).
- **로그아웃 상태 `ceal capabilities`가 "바이너리를 재설치하라"고 답하고 있었다.**
  `CEAL_COMMANDS[2].recovery`는 쓰일 당시 `session`이었는데 위에 `update` 행이 끼면서
  옮겨갔다. 인덱스는 다른 곳을 가리켜도 계속 유효하다. 이름으로 조회하게 고쳤고, 선언
  테이블에 대한 **위치 인덱스 자체를 금지하는 sweep**을 넣었다. 잡았어야 할 테스트는
  `typeof next_action === "string"`이었다 — 이제 테이블에서 기대값을 유도한다.
- **`ceal observe`와 discovery cache가 freshness 사본을 따로 들고 있었고 갈렸다.** store 쪽만
  역행 시계 가드가 자랐다. 시계가 뒤로 밀리면 observe는 `within_ttl: true`인데
  `capabilities`는 매번 재탐색 — "캐시가 왜 안 먹히지"를 답하는 도구가 신선하다고 답했다.
  `discoveryCacheFreshness` 하나로 모았다.
- **`chmod 644 ~/.ceal/receipt-spool.json` 하나가 30일치 영수증을 통째로 날렸다.** 재현함:
  3건 → chmod → append 1건 → `load()`가 1건만 반환. append가 성공했으므로 `recordDrop`도
  안 걸려서 **드롭 표시조차 없다**. append의 읽기는 어차피 0o600으로 다시 쓸 파일이므로
  모드에 관대해졌다(디렉터리 검사는 그대로 = 안전 근거). 파싱 불가 내용의 soft-miss는
  의도된 동작이라 그대로 뒀다.
- **크래시한 홀더와 재사용된 pid가 store를 영구히 잠갔다.** 0바이트 `owner.json`(= `wx` 직후
  크래시)과 `kill(pid,0)`의 `EPERM`(= 다른 유저가 pid 재사용)이 둘 다 `unsafe_store`였고,
  그건 아무도 못 푸는 상태다. 전자는 이웃한 방기 케이스들과 같은 grace로, 후자는 살아있는
  홀더와 같은 경로(`busy`, 유계)로 보낸다. 모드 검사는 보안 검사라 그대로 거절한다.

### frozen protocol sync (`bbbd733`)

`vinc`의 정책 픽스처를 렌더링하려 했더니 **렌더링 전에 디코더가 거부**했다. 픽스처 두 케이스를
빌드된 디코더에 통과시켜 확인: negotiated는 `CealProtocolValidationError`, legacy는 통과.
`validateDiscoveryCapability`의 `requireExactKeys`가 닫힌 키 집합이라 `announcement_policy`가
없으면 거부한다 — `vinc`의 안전 규칙("예상 밖 shape은 디코더로 거부")이 **예상한 shape에** 걸린 것.

설계 공백이 아니라 **stale frozen 사본**이었다. owner에는 필드·closed authority union·
`validateAnnouncementPolicy`가 이미 다 있었고, 드리프트 240줄이 전부 단방향이며 이 레인에서
originate한 편집은 없었다(유일하게 달라 보이던 줄은 owner가 `url`→`url || source_url`로 넓힌 것).
그래서 CLAUDE.md가 허용하는 경로 그대로 **target-derived sync**를 손편집 없이 복사로 랜딩했다.

**정체성은 인용이 아니라 확인 가능하다**: 소스는 `corca-ai/ceal@69ac63ae1`,
`packages/ceal-protocol` 트리 `91125f983602012712abc3bc8c886ecb4c8fe406`.
sync 후 이 리포의 같은 경로가 **같은 tree object로 해시된다**(`git rev-parse HEAD:packages/ceal-protocol`).

package.json도 결국 같이 동기화했다. repository/homepage/bugs가 `ceal-cli`를 가리켜서 사본별
의도적 차이인 줄 알았는데, **owner의 테스트가 `corca-ai/ceal`로 핀하고 있었다** — packing 픽스처가
이미 그렇게 덮어쓰고 있었으니 그냥 낡은 것이었다. 내 첫 판단이 틀렸고 게이트가 잡았다.

**남은 문제는 버전이다.** sync 전후 양쪽 다 `0.65.0`인데 검증기가 실질적으로 다르다.
`vinc`에 문제제기만 써 뒀다(해결책 제시 없이 — 버전 정책은 owner 몫).

## Next Session

1. **공지 준비(announcement readiness) — 리턴 패킷은 썼고, 공은 `vinc`에 있다.**
   요청서는 `oc:~/ceal/docs/requests/2026-07-27-to-narnia-ceal-cli-internal-announcement-readiness.md`.
   답은 [리턴 패킷](requests/2026-07-27-to-gateway-lane-announcement-readiness.md).
   - 증거 있는 플랫폼은 **`linux-amd64` 하나뿐**이다. 나머지 셋은 서명된 에셋만 있고 설치
     증거가 없다. Mac·arm64 기기를 누가 줄지가 정해지기 전에는 공지에 넣을 수 없다.
   - `npm run accept:worker`가 그 증거를 기계로 만든다. bounded call은 opt-in이다
     (`--capability`/`--target`) — 실제 provider 동작이라 기본값이 아니다.
   - 요청 3번(정책 범위 렌더링)은 **descriptor에 필드가 없어서 막혀 있다.** 패킷 §4가
     필요한 필드 여섯을 정확히 지목했다. `vinc` 답이 오면 그때 렌더링을 붙인다.
2. **`#6` rollback rehearsal — `vinc` 대기이고, 아직 이 레인 차례가 아니다.**
   2026-07-27 확인: ledger `current_stage: 2`(`cli_source`, in_progress), `#6`이 사는
   stage 5 `consumer_cutover`는 `planned`, `rollback.rehearsals`는 빈 배열.
   그리고 **`@corca-ai/ceal-protocol`이 npm에 없다**(404) — `#6`의 수용 증거가 요구하는
   "immutable, Gateway-owned packed artifact"가 소비할 수 있게 존재하지 않는다. 오늘 검증된
   tarball은 `private_agent_host` 쪽이고 별개 소비자다. `vinc`에 질문을 넣어 뒀다.
3. **`corca-ai/ceal#633` 미관측 축 셋 — 처분 결정 대기.** 이슈는 2026-07-26에 **closed**다
   (`vinc`의 라이브 증명). cursor continuation은 그 증명에 포함됐으므로 **드롭**. 남은 셋은
   포함 안 됐다: `message_ref` TTL **만료**(발견 가능성만 확인됨), 재시작 후 cursor 생존,
   `since`/`until` 경계 페이지. 드롭할지·`vinc`가 새 이슈로 가져갈지·이 레인이 돌릴지 물어 뒀다.
   이 레인이 돌리려면 dev 인스턴스 이름 + Gateway 재시작(둘 다 `vinc`)이 필요하고,
   **dev 재등록은 이 호스트의 prod 바인딩을 파괴한다.** 명시적 go 없이는 시작하지 말 것.
4. **품질 리뷰 3차의 active 카드 — 막힘 없음, 이 레인 안에서 끝난다.**
   [리뷰](../charness-artifacts/quality/latest.md) `## Recommended Next Quality Moves` 참조.
   - `ceal update`에 데드라인이 없다(`stable-update.ts:189-215`, `install-ceal.sh`의 `curl`에
     `--max-time` 없음). 블랙홀 연결이나 동시 update가 걸리면 envelope 없이 무한 대기한다.
     이 CLI의 다른 모든 대기는 유계다. **읽기만 했고 재현은 안 했다.**
   - `createLock` 실패 정리에 `releaseLock`이 가진 소유권 검사가 없다
     (`local-store-lock.ts:93-96`). 후임자의 락을 지울 수 있다. 복사할 올바른 모양이
     `releaseLock:105-112`에 이미 있다. **읽기만 했고 재현은 안 했다.**

## Current State

- **열린 이슈는 `#6` 하나**, 완전히 `vinc` 대기(위 2번).
- **`vinc`에 요청/질문이 걸려 있다.** 프롬프트는 `docs/requests/`가 소유하고 운영자가
  직접 넣는다. **새로 둘 추가, 둘 다 `oc`에 전달 완료**:
  [`cealctl` 락 복구 불능 둘](requests/2026-07-27-to-gateway-lane-cealctl-lock-recovery.md)
  — worker에서 고친 결함 둘이 frozen인 `ceal-operator-cli`에 그대로 있고, **operator store의
  빌드된 코드로 직접 재현했다**(zero-byte `owner.json`·pid 1 `EPERM` 둘 다 `unsafe_state_path`
  즉시, missing-owner 대조군은 정상 회수). 그리고
  [protocol 아티팩트 정체성 + 레인 사실 정정 둘](requests/2026-07-27-to-gateway-lane-protocol-artifact-identity.md)
  — **`#6`에 npm은 필요 없다**는 결론(운영자 판단 2026-07-27: 임의 머신 해석 불필요)과,
  `vinc`가 stale 클론으로 이 레인을 평가한 건·`dist-*` 귀속 오류 정정. 그리고 **셋째**:
  [protocol 버전이 바이트를 구분하지 못한다](requests/2026-07-27-to-gateway-lane-protocol-version-identity.md)
  — 아래 `## Closed` 참조. **셋 다 `oc`에 전달 완료.** 기존 것들:
  [기존 넷](requests/2026-07-27-to-gateway-lane.md), 그리고 오늘의
  [막힘 판단 + 질문 둘](requests/2026-07-27-narnia-blocked-assessment.md) — 후자는
  `oc:~/ceal/2026-07-27-from-narnia-blocked-assessment.md`로 이미 전달했다(새 untracked 최상위
  `*.md` 하나만 추가; tracked 파일 무변경).
- **공지 준비 리턴 패킷은 전달 완료** — `oc:~/ceal/2026-07-27-from-narnia-announcement-readiness-return-packet.md`
  (새 untracked 최상위 `*.md` 하나만 추가; tracked 파일 무변경, digest 대조함).
- **`prod` 세션은 살아 있다**(2026-07-27T21:15–21:21Z 관측). 미검증은 `enrollments create` →
  `request_denied` 하나뿐(write라 미실행).
- **게이트**(2026-07-27 narnia, 병렬화 이후): `npm run check` 43.4–46.8s 통과, `check:unit`
  21.8s. **이 수치를 인용하지 말고 다시 잴 것** — 36코어 호스트 값이고, CI 러너는 코어가
  훨씬 적다(`--test-concurrency` 2에서 37.3s, 4에서 26.5s로 측정).
- **병렬 tier는 아직 narnia에서만 증명됐다.** ubuntu·macOS 러너에서 초록인 것은 push 후에야
  안다. 의심 지점 둘은 품질 리뷰 `## Weak`에 적어 뒀다(`~/.npm/_cacache` 동시 접근,
  `build-worker-release-artifact.test.mjs:111`의 pid 기반 tmp 경로).
- **`@corca-ai/ceal-protocol@0.65.0`은 바이트가 세 벌**(버전 미범프 재빌드). 새로 핀할 땐
  producing commit+tree에 묶을 것.

## Debt

- **~~`docs/operator-acceptance.md`가 없다`~~ — 2026-07-27 작성됨.** 천장(`version`/
  `commands`/`guide status`/`observe`), 상대역을 호스트명이 아니라 **역할**로, 태그를 태우기
  전에 확인할 릴리스 레인 접근물과 각각의 read-only 확인 명령을 담았다. 그 과정에서 확인된
  것: **`ceal-npm-release` 환경에 변수가 하나도 없다** → 지금 bare `v*` 태그를 밀면 첫 게이트에서
  바로 거절되며 버전만 태운다. 이 레인은 bare `v*`를 밀지 않으므로 차단은 아니지만, 기록해 둔다.
- **drop count는 언제나 하한이지 총계가 아니다.** SIGKILL, `HOME` 미설정, 카운터 자체의 실패는
  세어지지 않는다. `dropped_appends_are_a_floor`가 페이로드에 이걸 명시한다.
- **관측기 HTML 검사는 소스 형태 검사다.** 분기 **삭제**는 잡고 **무력화**(`if (false)`)는 못 잡는다.
  닫으려면 게이트에 DOM이 필요하다.
- **frozen 사본 sync는 리포 분리 완료까지 대기** — 설계하지 않기로 했다(운영자 판단, 2026-07-27).
  `skills/cealctl-guide`와 `ceal-guide`의 SKILL.md 중복(0.95)도 같은 이유로 `Deferred`.
- **미해결 PLAUSIBLE 둘**: `recordDrop`의 cap 검사가 N개 프로세스에서 최대 N-1바이트 초과 가능
  (표시상 불일치뿐), `prepareDirectory`의 `mkdir` 오류 순서가 macOS/BSD에서 Linux와 같은지는
  mac 러너에서만 확인 가능.

## References

- [품질 리뷰 2026-07-27 3차 — 현재 기준선](../charness-artifacts/quality/latest.md)
- [`cealctl` 락 복구 불능 둘](requests/2026-07-27-to-gateway-lane-cealctl-lock-recovery.md) ·
  [protocol 아티팩트 정체성과 레인 사실 정정](requests/2026-07-27-to-gateway-lane-protocol-artifact-identity.md)
- [Gateway 레인 요청 넷](requests/2026-07-27-to-gateway-lane.md) ·
  [막힘 판단과 질문 둘](requests/2026-07-27-narnia-blocked-assessment.md) ·
  [공지 준비 리턴 패킷](requests/2026-07-27-to-gateway-lane-announcement-readiness.md)
- [운영자 수용 천장](operator-acceptance.md)
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md)
