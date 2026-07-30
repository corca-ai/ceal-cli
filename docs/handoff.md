# Session Handoff
Date: 2026-07-28 — **`ceal-v0.69.0`이 `gateway-handoff-v0.67.0` 쌍 위에서 릴리스·게시됐고
설치·실세션·provider·receipt 증거까지 반환했다.** 공지에 남은 실질 관문은 **Mac 증거**와
**온보딩 절차**다. 이 레인은 `corca-ai/ceal-cli`만 다룬다.

## Workflow Trigger

- 이 파일만 언급되면 **`## Waiting On`을 먼저 재라.** 답이 와 있으면 해당 항목으로
  `charness:impl`을 시작하고, 아니면 `## Unblocked Now`에서 고른다.
- **재계획도 chunked routing도 돌리지 말 것.**
- 레인 간 답은 **세 곳**을 봐야 한다: `oc:~/ceal`의 untracked `to-narnia-*`, **`oc`의 로컬
  커밋**(`git log origin/main..HEAD`), GitHub의 `corca-ai/ceal`. **우리가 보낸 `from-narnia-*`가
  사라진 건 정상**(소화 후 삭제가 운영자 규칙) — 배송 실패로 오진하지 말 것. 두 번 틀렸다.
- `ceal capabilities --fresh`, `ceal call`은 실세션·provider 동작이라 승인 후에만.

## Waiting On

1. **Mac acceptance 레코드.** Mac에 `0.68.0`이 서명 검증되어 설치돼 있지만 **세션이 없다.**
   등록 코드가 필요하고, 그건 게이트웨이 호스트에서 `cealctl`로 발급한다. 절차와 마찰은
   [보고서](requests/2026-07-28-to-gateway-lane-client-onboarding-usability.md)에 있다.
   **이게 오면 공지 문구에서 Mac을 뺄 이유가 사라진다. 그 전엔 반드시 빼야 한다.**
   받는 법: 터미널 2줄(설치·`session enroll`) 뒤 `ceal acceptance emit --request-ref <ref>`.
   clone도 `node`도 불필요하다. 결과를 `docs/acceptance/ceal-v0.69.0/darwin-arm64.yaml`로 커밋.
2. **`gateway-handoff-v0.68.0` 아카이브의 release origin 게시.** 지금 이 아카이브는
   **30일짜리 Actions artifact로만 존재한다.** `.github/workflows/ceal-release.yml`은
   `$GATEWAY_HANDOFF_ORIGIN/<tag>/<archive>`에서 받는데 그 경로는 **현재 404**다.
   lock/vendor는 끝났지만 **이 상태로는 어떤 worker 릴리스도 태그 즉시 죽는다**(그리고
   태그는 재사용 불가). `vinc` 소유. 2026-07-28에 이미 같은 요청을 보냈다
   ([publish-handoff-archive-to-release-origin](requests/2026-07-28-to-gateway-lane-publish-handoff-archive-to-release-origin.md)).
3. **v2 픽스처** `d7c8ae0f…`의 릴리스 경계 인계, 그리고 sanitize 시 `instance_ref`/
   `profile_ref` 필요 여부(기본값 **유지**로 구현돼 있음).
4. **provenance seam 답.** Agent lease/event/requester를 Gateway audit event에 묶는
   계약이 **없다.** `receipt.request_ref` ↔ audit `request_id` 결합만 있고, 그건 사후
   조인이라 Agent 자기 로그만큼만 믿을 수 있다. 제안(`ceal.request_provenance.v1`,
   audit 영속화·receipt 반환, 선택적 caller-supplied `--request-ref`)은 패킷 §5와
   `oc:~/ceal`의 `2026-07-29-from-narnia-…-provenance-seam-request.md`에 있다.
   **세 조각 중 protocol/Gateway 둘은 `vinc` 소유라 이 레인 혼자 못 낸다.**
   답이 오면 이 레인은 `ceal call`의 `--agent-lease` 등 옵션만 붙이면 된다.

## Unblocked Now

- **`ceal session adopt` 구현.** 이게 지금 이 레인의 차단 과제다(게이트웨이 요청:
  `oc:~/ceal/2026-07-29-to-narnia-verified-email-first-device-consumer-unblock.md`).
  protocol이 도착했으니 private schema를 발명할 이유가 없다 — Gateway 소유 decoder만 쓴다.
  착수 전에 **HPKE 결정**을 먼저 받아라: 요구 스위트는
  `DHKEM(X25519,HKDF-SHA256)/HKDF-SHA256/AES-256-GCM`인데 **Node 22에 네이티브 HPKE가 없다.**
  프리미티브(Ed25519·X25519 `diffieHellman`·`hkdfSync`·AES-256-GCM)는 전부 있으니 RFC 9180
  base mode를 직접 조립할 수는 있으나, 그건 **서명 릴리스에 자작 암호를 넣는 것**이다.
  대안은 의존성 추가인데 현재 번들 런타임 의존성은 `yaml` 하나뿐이다. 운영자 결정 사항.
- **`x-ceal-announcement-policy: v2` 활성화가 이제 가능하다.** vendored `0.67.0` 디코더가
  **capability 20개 전부**를 바인딩한다(`resource.resolve`가 provider별 2항목, Calendar,
  Drive search, Sheets 포함) — 라이브 카탈로그의 20개와 같은 집합이다. 제가 보고했던 차단
  사유(닫힌 5개 표)는 해소됐다. 헤더는 **아직 안 보낸다**; 켜는 건 별도 변경 + 별도 증거다.
- 아래 `Debt`의 항목들.

## Current State

- **릴리스**: `ceal-v0.69.0` 게시, stable 포인터가 `0.68.0` → `0.69.0`으로 이동.
  `ceal-v0.67.0`은 **탔다**(linux-arm64, 미발행 — 핀 금지). `0.67.1`·`0.68.0`은 게시돼 있고
  `v0.66.1`을 소비한다.
- **lock은 이제 `gateway-handoff-v0.68.0`**(2026-07-29, `cfa6c28`): producer `844b19ce…`,
  tree `0771d062…`, protocol subtree `eea361e5…`, archive `8928840a…`, manifest
  `b0bd766a…`. archive는 로컬에서 sha256·cosign(게이트웨이 태그 identity) 둘 다 재검증했고
  vendored subtree는 `HEAD:packages/ceal-protocol`이 `eea361e5…`로 정확히 일치한다.
  pin은 `agreed`. **`@corca-ai/ceal-protocol@0.68.0`이 `device-enrollment`를 root export로
  싣는다**(15개 심볼 확인) — `ceal session adopt`의 전제가 갖춰졌다.
  소비 dependency 셋(client·worker-cli·**frozen operator-cli**)은 계약 테스트가 요구하는
  대로 함께 `0.68.0`으로 올렸다. operator-cli의 버전 단언 수정은 sync의 파생 결과이지
  독립 편집이 아니다(테스트 주석이 그 선례를 이미 적어두고 있다).
- **이전 lock `gateway-handoff-v0.67.0`**: producer `0261f0a4…`, protocol subtree
  `58d7d639…`, archive `94093501…`. **게시된 `ceal-v0.69.0` 바이너리가 담은 건 이쪽이다.**
- **lock이 이제 Protocol/Client 쌍을 선언한다.** 이전엔 두 tarball 이름을 handoff 태그에서
  유도해서, Protocol 0.67.0 + Client 0.69.0인 진짜 쌍을 **소비할 수 없었다.** 게이트웨이가
  packer에서 푼 결합이 우리 소비자에도 있었고, **모든 픽스처가 두 패키지에 같은 버전을 써서
  픽스처가 버그와 합의**하고 있었다. 지금 픽스처는 Client 버전을 태그와 일부러 다르게 둔다.
- **증거**(`linux-amd64`): `docs/acceptance/ceal-v0.69.0/linux-amd64.yaml`,
  blob `d2d99610…`, sha256 `7995ff66…`. 서명 설치 → guide → 실세션(`instance:ceal-prod`,
  20 capability) → bounded read → receipt `verified`/`succeeded`/`allowed`.
  [반환 패킷](requests/2026-07-28-to-gateway-lane-v0.69.0-released-and-evidenced.md).
- **`ceal-agent` 소비 패킷 반환**(2026-07-29, `dfd3405` 푸시됨):
  [packet](requests/2026-07-29-to-ceal-agent-lane-source-owner-consumption-packet.json).
  current `0.69.0` + rollback `0.68.0`의 signed envelope, 설치 선택, embedded
  provenance, CLI 계약, seam 상태를 pin 가능한 JSON 하나로 묶었다. **새 기능 없음.**
  `ceal-agent`가 "Actions artifact의 `artifact_state: unsigned_build_candidate`이라
  서명본이 없다"고 읽었던 건 오독이다 — 그 필드는 compose 시점 자기 서술이라 **게시본
  manifest에도 같은 값이 남는다.** 서명 판정은 오직 `.pem`/`.sig` sidecar다. 다시 물어올
  질문이라 패킷 맨 앞에 교정으로 박아뒀다.
- **`ceal acceptance emit`**(0.68.0부터): 설치본이 체크아웃 없이 레코드를 만든다. `--binary`가
  없고(실행 중 바이너리를 잰다), **provider 호출을 하지 않으며**(`--request-ref`는 읽기).
- **브랜치 `client-protocol-0.67.0-sync` @ `fd771d46…`는 소임을 다했다.** `main`이 이제 그
  선언을 정당하게 담는다. 삭제 가능하나, 그쪽 기록이 가리킬까 봐 남겨뒀다.
- **2026-07-28 측정**: `check` 45~52s, `check:unit` 21.4s(36코어).
- **2026-07-30 gate ownership**: branch pre-push and `check.yml` now run only
  explicit worker test inventories: client/worker unit tests, worker contract
  tests (including `ceal-guide`), and worker release proofs. `cealctl`,
  `cealctl-guide`, and legacy dual-release checks require the explicit
  `npm run test:legacy-compatibility` audit and cannot re-enter branch CI through
  a glob. The frozen protocol is still built solely as the client type-check
  input; this does **not** claim artifact-only protocol consumption in this
  repository.

## Discuss

- **공지 문구에서 Mac을 빼야 한다.** 빌드·서명은 네 플랫폼 다 되지만 **설치+세션 증거는
  `linux-amd64`뿐**이다. capability도 20개 중 1개만 provider에 도달했다.
- **온보딩이 공지의 가장 약한 표면이다.** 사람 하나 온보딩에 운영자가 5단계를 밟고, 그중
  하나는 전체 레지스트리 교체다. 이메일은 절차 어디에도 안 들어간다. 공지 대상을 운영자가
  직접 챙길 범위로 한정하거나, self-serve seam을 먼저 넣어야 한다. 전부 `vinc` 소유다.

## Debt

- **acceptance 레코드의 receipt 가지가 allow-list가 아니다.** 게이트웨이 receipt events를
  projection 없이 통과시켜서 `membership_ref`·`subject_ref`가 실린다. 게이트웨이가 발급한
  식별자를 게이트웨이에 돌려주는 것이라 유출은 아니지만, 레코드 자신의 "assembled by
  allow-list" 문구가 그 가지에 대해선 과장이다. 게이트웨이에도 보고했다.
- **signed release manifest에 client 패키지가 없다.**
  `ceal-worker-release-manifest-<platform>.json`은 protocol만 기록한다. `@corca-ai/ceal`
  수치는 릴리스 커밋의 lock → archive digest → `gateway-artifact-handoff.json`으로
  **전이적으로만** 커버된다. 소비자는 그걸 signed-manifest 사실이 아니라 source-owner
  주장으로 pin해야 한다. manifest 스키마 추가는 릴리스에 영향을 주는 변경이라 패킷 안에서
  하지 않았다.
- **`@corca-ai/ceal@0.69.0`이 두 개의 서로 다른 tarball을 가리킨다.** `v0.67.0` handoff의
  것은 `085839e1…`(게시된 `ceal-v0.69.0` 바이너리가 담은 것), `v0.68.0` handoff의 것은
  `50405db9…`다. protocol dependency가 `0.67.0`→`0.68.0`으로 바뀌었는데 client 버전은 안
  올랐다. 버전 문자열이 더 이상 바이트를 식별하지 못한다 — `ceal-agent`에 보낸 패킷은
  게시된 릴리스 기준이라 여전히 맞지만, 다음 릴리스는 같은 이름의 다른 바이트를 담는다.
  `vinc`에 알려야 한다.
- **레코드가 두 형식이다**: 리포 스크립트는 JSON, 설치형 명령은 YAML(모든 공개 명령이 YAML
  한 문서라는 게이트 때문). 같은 스키마에 형식 둘은 소비자에게 지저분하다.
- **요구 3에 행위 테스트가 없다.** 다섯 경로의 발산 거부는 `repo-gates.test.mjs`의 소스 형태
  게이트로만 붙들려 있다. live pin이 수렴 상태라 행위로 falsify가 안 된다.
- **동결 경로 우회**: `source.tree`만 올리는 수는 `invalid_protocol_vendor_pin`으로 죽지만,
  `shipped.protocol_tree`까지 함께 위조하면 통과한다(두 필드 고의 위조 필요).
- **worker `createLock`의 잔여 경합**은 이 레인 소유이고 미해결.
- **CI에 macOS 설치 레그가 없다.** `require_platform_proofs`는 릴리스·설치기 **테스트 스위트**
  얘기라 이 공백의 근거로 인용하면 틀린다. 그 플래그를 `linux-*` 전체에 요구한 것이
  `ceal-v0.67.0`을 태웠다 — 지금은 `linux-amd64`로 좁혔고 게이트가 지킨다.
- 나머지는 해당 주석·[gates.md](gates.md)가 소유한다.

## References

- [Gateway 레인 답·계약](requests/from-gateway-lane/) — **원문이 authoritative**
- [이 레인이 보낸 것](requests/) — v2 디코더 분석, 증거 패킷 둘, 호환성 입력, 순서 교착,
  온보딩 보고서, 동결 경로 통보
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md) ·
  [운영자 수용 천장](operator-acceptance.md)
