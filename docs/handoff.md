# Session Handoff
Date: 2026-07-28 — **계획 순서를 다 소진했고, 릴리스·설치·provider 증거까지 끝냈다.**
`ceal-v0.68.0`이 게시됐고 stable이며, 설치본이 체크아웃 없이 자기 acceptance 레코드를
만든다. 남은 건 전부 **다른 레인의 답이나 사람의 실행**을 기다리는 것이다.
**이 레인은 `corca-ai/ceal-cli`만 다룬다.**

## Workflow Trigger

- 이 파일만 언급되면 **`## Waiting On`을 먼저 재라.** 답이 와 있으면 해당 항목으로
  `charness:impl`을 시작하고, 아니면 `## Unblocked Now`만 남는다.
- **재계획도 chunked routing도 돌리지 말 것.** 남은 순서는 이 레인 backlog가 아니라
  게이트웨이 공지 순서에서 유도된 것이라, 다시 랭킹하면 되돌아간다.
- 레인 간 답 확인은 **세 곳을 다 봐야 한다**: `oc:~/ceal`의 untracked `to-narnia-*`,
  **`oc`의 로컬 커밋**(`git log origin/main..HEAD` — push 전 상태로 답이 와 있던 적 있다),
  그리고 GitHub의 `corca-ai/ceal`. **우리가 보낸 `from-narnia-*`가 사라져 있는 건 정상이다** —
  소화 후 지우기로 운영자가 정해둔 규칙이고, 배송 실패가 아니다(두 번 오진했다).
- `ceal capabilities --fresh`, `ceal call`은 **실세션·provider 동작**이라 승인 후에만.

## Waiting On

1. **다음 Protocol 패키지 버전 `N`, 또는 "0.68.0 소스로 패킹하겠다"는 답.**
   [보낸 분석](requests/2026-07-28-to-gateway-lane-source-only-sync-ordering-and-question.md).
   Gateway는 v2 디코더를 담은 아카이브를 만들려면 `N`을 선언한 클라이언트 소스가 필요하고,
   이 레인은 `N`을 담은 아티팩트가 잠기기 전엔 선언할 수 없다 — **순서 교착이다.**
   그 편집을 시뮬레이션해 실제로 재봤고 게이트 두 곳이 붉어진다(`release-contract`,
   `protocol_version_mismatch`). 답이 오면 소비는 lock+vendor+pin+선언 **한 커밋**이다.
2. **Mac 실행.** 이제 clone이 필요 없다: 터미널 2줄(설치·`session enroll`) 뒤
   `ceal acceptance emit --request-ref <ref>` 하나면 레코드가 나온다. 결과가 오면
   `docs/acceptance/ceal-v0.68.0/darwin-<arch>.json`으로 커밋하고 반환 패킷을 갱신한다.
3. **v2 픽스처** `d7c8ae0f…` 릴리스 경계 인계, 그리고 sanitize 시 `instance_ref`/
   `profile_ref` 필요 여부. 후자는 **유지**를 기본값으로 구현해 뒀으니 답이 다르면 한 줄.

## Unblocked Now

없다. 릴리스 관련 작업은 모두 위 대기에 걸려 있다. 새 일감이 필요하면 `Debt`에서
고르되 `createLock` 경합이 유일하게 자기완결적이다.

## Current State

- **릴리스 셋을 뗐다.** `ceal-v0.67.0`은 **탔다**(linux-arm64에서 실패, 미발행 — 핀 금지).
  `ceal-v0.67.1`, `ceal-v0.68.0`이 게시됐고 **stable은 `0.68.0`**.
- **`v0.66.1` 아티팩트 소비 완료.** 다섯 digest 전부 로컬 재계산. lock·vendored
  사본(`ac602cc1…`)·pin이 한 커밋. 발산은 닫혔고 pin은 `agreed`.
- **증거 사슬이 닫혔다**(`linux-amd64`): 서명 설치(cosign 6건) → guide → 실세션 discovery
  (`instance:ceal-prod`, 20 capability) → bounded read `github.repository.get` →
  receipt `verified`/`succeeded`/`allowed`. 레코드는
  `docs/acceptance/ceal-v0.67.1/linux-amd64.json`, 불변 튜플은
  [반환 패킷](requests/2026-07-28-to-gateway-lane-installed-client-evidence-packet.md).
- **`ceal acceptance emit`이 0.68.0에 들어갔다.** 빈 디렉터리에서 검증했다. `--binary`가
  없고(실행 중인 바이너리를 잰다), **provider 호출을 하지 않으며**(`--request-ref`는 읽기),
  allow-list 조립이라 호스트 경로가 실릴 수 없다. 설치 호스트엔 lock이 없어 producer 튜플을
  교차검증 못 한다는 것도 레코드가 스스로 non-claim으로 말한다.
- **v2 헤더는 못 켠다.** vendored `v0.66.1` 디코더가 정책을 닫힌 5개 capability 표에
  묶는데 v2 매트릭스의 `resource.resolve`·Calendar·Sheets·Drive search가 전부 밖이다.
  바인딩 불가 정책은 `validateDiscoveryCapability` 안에서 터져 **discovery 응답 전체가
  디코드 불가**가 된다. 지금 헤더를 켜면 프로덕션이 깨진다.
- **동결 경로 셋을 건드렸고 통보·동기화됐다**(`operator-cli` 둘 + 미러 `release-contract.json`).
  아티팩트를 소비할 때마다 재발한다 — 리포 분리 전까지.
- **2026-07-28 측정**(인용 말고 다시 잴 것): `check` 45~52s, `check:unit` 21.4s(36코어).

## Discuss

- **공지 문구에서 Mac을 빼야 한다.** 빌드·서명은 네 플랫폼 다 되지만 **설치 증거는
  `linux-amd64`뿐**이다. capability도 20개 중 1개만 provider에 도달했다.
- 미푸시 커밋은 `git log @{u}..HEAD`로 **재서** 말할 것. 세지 말 것.

## Debt

- **요구 3에 행위 테스트가 없다.** 다섯 경로의 발산 거부는 `repo-gates.test.mjs`의 소스
  형태 게이트로만 붙들려 있다. live pin이 수렴 상태라 행위로 falsify가 안 된다 — 다음
  발산 때 진짜 테스트를 붙일 것.
- **동결 경로 우회가 좁아졌다**: `source.tree`만 올리는 수는 이제
  `invalid_protocol_vendor_pin`으로 죽는다. 남은 구멍은 `shipped.protocol_tree`까지 함께
  위조하는 경우로, **두 필드를 고의로 거짓 기재**해야 한다. vendored 바이트를 owner
  산출물과 대조하는 것은 여전히 없다.
- **acceptance 레코드가 두 형식이다**: 리포 스크립트는 JSON, 설치형 명령은 YAML(모든 공개
  명령이 YAML 한 문서라는 게이트 때문). 같은 스키마에 형식이 둘인 건 소비자에게 지저분하다.
- **worker `createLock`의 잔여 경합은 이 레인 소유이고 미해결**(claim 없는 디렉터리 교체,
  inode 20/20 재사용).
- **CI에 macOS 설치 레그가 없다.** `require_platform_proofs`는 릴리스·설치기 **테스트
  스위트** 얘기라 이 공백의 근거로 인용하면 틀린다. 그리고 그 플래그를 `linux-*` 전체에
  요구한 것이 `ceal-v0.67.0`을 태웠다 — 지금은 `linux-amd64`로 좁혔고 게이트가 지킨다.
- 나머지(가드가 수렴을 관측 못 하는 한계, update 파이프 해제 미게이트, 설치기 `curl` 변수
  호출 우회, drop count 하한, 관측기 HTML 검사)는 해당 주석·[gates.md](gates.md)·품질
  리뷰가 소유한다.

## References

- [Gateway 레인 답·계약](requests/from-gateway-lane/) — **원문이 authoritative**
- [이 레인이 보낸 것](requests/) — v2 디코더 분석, 증거 패킷, 호환성 입력, 순서 교착
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md) ·
  [운영자 수용 천장](operator-acceptance.md)
- 계획 문서(`charness-artifacts/impl/2026-07-28-post-v0.66.1-plan.md`)는 **소진됐다.**
