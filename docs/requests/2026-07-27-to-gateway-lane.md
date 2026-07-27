# Prompt for the Gateway lane (`vinc`)

Paste the block below into a session on the Gateway host. It is self-contained;
the operator should not need to relay anything back to `narnia` to start.

---

이 호스트는 `vinc`(Gateway 레인, 체크아웃 `~/ceal`)입니다. `narnia`(`corca-ai/ceal-cli`
레인)에서 온 요청 셋입니다. 근거는 이미 이 체크아웃 최상위에 untracked로 놓여 있습니다:

- `handoff-from-narnia-2026-07-27-agent-artifact-binding.md`
- `handoff-from-narnia-2026-07-27-prod-session-and-protocol-consumer.md`

먼저 그 둘을 읽으세요. 아래는 요약과 우선순위입니다.

## 배경 사실 하나 — 이게 셋 다의 뿌리입니다

`@corca-ai/ceal-protocol@0.65.0` 한 버전이 **서로 다른 바이트 세 벌**을 냈습니다:

| sha256 | producing commit | 관측 경로 |
| --- | --- | --- |
| `6d496cdb5fee…` | `e924dfa15594319ef41cf9155a85c2dd965b997f` | `ceal-cli` proof `2026-07-22-gateway-protocol-packed-worker-consumer.json` |
| `ddc81502dbd6…` | `27dd2fefed7157c648e703908a7bfd189eeb2a46` | `corca-ai/ceal-agent#2` 본문 |
| `3e4c0296f79a…` | `ac861859eb0f2bbe889f3fbaa537f9d0c765b08c` | 이 체크아웃에서 `npm run repository-extraction:gateway:verify` 읽기 전용 실행 (2026-07-27) |

버전을 안 올린 채 재빌드했기 때문입니다. 그래서 **digest만 핀하면 Gateway 커밋마다 깨집니다.**
리터럴을 새 값으로 갱신하는 건 해법이 아니고, 다음 커밋에서 같은 자리가 또 터집니다.

## 요청 1 (우선) — 고정된 digest 리터럴을 Agent 소유 기록으로 교체

지금 이 체크아웃에서 읽기 전용으로 재현됩니다:

```
npm run repository-extraction:proof-chain:validate -- --json
→ "error_code": "proof_binding_mismatch"
   "message": "Agent expected digest disagrees for @corca-ai/ceal @corca-ai/ceal-protocol"
```

대조 대상은 이 저장소의 소스 리터럴입니다 — `scripts/verify-ceal-agent-public-closure.mjs:42`
의 `EXPECTED_PUBLIC_PACKAGE_SHA256`. `validate-current-public-candidate-proof-chain.mjs:26`이
그걸 import해서 260·268행에서 씁니다.

**`narnia`가 이미 만들어 둔 것** — `corca-ai/ceal-agent@474ac96`:

- `gateway-artifact-handoff.json` — 수용된 Protocol/Client 쌍을 각 패키지의 version·sha256·
  npm integrity·declared exports, **그것을 만든 Gateway commit+tree**, 고정된 호환 범위,
  rollback 쌍과 복구 절차·미비 증거까지 담아 기록. 현재는 `ac861859…` 쌍을 수용 중.
- `scripts/verify-gateway-artifact-handoff.mjs` — 그 기록을 엄격 검증하고 공급된 tarball
  바이트를 sha256과 npm integrity **양쪽으로** 대조. 실패 시 고쳐야 할 파일을 지목하며 fail
  closed. export: `loadGatewayArtifactHandoff`, `validateGatewayArtifactHandoff`,
  `verifyGatewayArtifactHandoff`, `HANDOFF_SCHEMA_VERSION`, `REQUIRED_PACKAGES`.
  모든 예외에 안정적인 `code`가 붙어 있어 영문 산문을 패턴 매칭할 필요가 없습니다.
- 테스트 16개, `npm run check` 35개 통과.

**해야 할 편집 둘 (이 저장소 소유)**:

1. `scripts/verify-ceal-agent-public-closure.mjs`에서 `EXPECTED_PUBLIC_PACKAGE_SHA256`를 없애고
   Agent의 `gateway-artifact-handoff.json`에서 수용 digest를 읽게 하기.
2. `config/ceal-agent-public-source-map.json`에 `gateway-artifact-handoff.json`를 추가하고,
   같은 파일의 `EXPECTED_SOURCE_FILE_COUNT`(현재 `18`)를 그에 맞게 올리기.

Agent의 기록을 **체크아웃에서 읽을지 handoff 아카이브에 실어 나를지는 `vinc`의 설계 판단**입니다.
`narnia`는 그 부분에 증명할 수 있는 의견이 없습니다.

참고: `corca-ai/ceal-agent`는 2026-07-27부로 `vinc` 소유가 됐습니다. 위 커밋은 소유권 이전
직전에 `narnia`가 넘긴 인수인계물이지, `narnia`의 상시 책임이 아닙니다.

## 요청 2 — `corca-ai/ceal-cli#6`용 packed 아티팩트

`ceal-cli`의 소비자 쪽은 이미 옳습니다: `scripts/verify-gateway-protocol-consumer.mjs`는 digest를
하드코딩하지 않고 provenance 자기정합성만 검사하며, source-checkout 폴백이 없습니다. ledger의
`clean_ceal_cli_worker_packed_gateway_protocol`도 이미 **resolved**입니다.

남은 건 증거가 낡았다는 것뿐입니다 — worker `0e1b256faccf…` 기준인데 `ceal-cli` `main`은
그보다 한참 앞서 있습니다(현재 `ceal-v0.66.1`).

**필요한 것**: 지정된 Gateway 커밋에서 만든 packed protocol 아티팩트 하나와 그
`ceal.gateway_protocol_artifact.v1` provenance. `node scripts/pack-gateway-protocol-artifact.mjs
--out <절대경로>`가 그 산출물입니다. 받으면 `narnia`가 현재 `main` 기준으로 소비자 검증을 재실행해
새 proof를 남깁니다.

## 요청 3 — rollback 쌍의 producing commit

ledger의 `gateway_protocol_source.rollback_proof`가 `pending`이고, 그걸 푸는 데 한 조각이
빕니다. client digest

```
3d959dcb915e1bc72d2d97bbc24f2ed7560169ea7ed2960177f301102307eb8e
```

는 **위 소스 리터럴 안에만 존재하고 만든 커밋이 기록된 적이 없습니다.** 그래서 re-pack도 증명도
불가능합니다. 그 digest를 만든 **commit과 tree**를 알려주시면 `narnia`가 rollback 쌍을 거기에
묶어 리허설하고, `ceal-agent#2`도 그때 닫힙니다.

찾을 수 없다면 그것도 답입니다 — 그때는 rollback 기준선을 현재 알려진 쌍으로 다시 잡는 쪽으로
갑니다. 다만 **모른다는 사실이 기록되어야** 합니다.

## 나중에 (마지막 순서) — `corca-ai/ceal#633` 프로브

`narnia`가 남은 프로브(재시작 후 cursor 생존, `message_ref` TTL 만료, `since`/`until` 경계
페이지)를 끝내려면 dev 인스턴스로 재등록해야 하는데, 그러면 로컬 prod 바인딩이 파괴됩니다.
그래서 위 셋이 정리된 뒤에만 합니다. 그때 필요한 것 둘:

- **dev 인스턴스 이름**
- **Gateway 재시작** — 이건 `vinc`의 행위이지 `narnia`가 할 수 있는 일이 아닙니다

지금 당장은 필요 없습니다. 순서만 알아두시면 됩니다.

## 참고 — prod 세션은 정상입니다

이전 baton이 들고 있던 저하 보고(토큰 ~15분 만료, renewal `invalid_response`,
`enrollments create`가 `request_denied`)를 `narnia`가 전달 전에 재관측했고, **두 증상이
재현되지 않았습니다**. 2026-07-27T21:15–21:21Z, 설치본 `0.65.9`, 전부 `read_only` 라우트:

- `ceal capabilities --fresh` → `host_decision: accepted`, `instance:ceal-prod`, protocol 1.3.0
- access token 수명은 정확히 15분이 맞지만, **만료 71초 뒤 같은 read_only 호출이 성공하며 세션이
  자동 갱신**됐습니다 (`expires_at` 21:20:26 → 21:34:38)

그러니 그 저하 보고는 **stale로 취급**하시면 됩니다. 예외는 하나 — `enrollments create` →
`request_denied`는 write 라우트라 `narnia`가 실행하지 않았고, 따라서 미검증으로 남아 있습니다.
그 경로가 중요하면 `vinc` 쪽에서 직접 확인해야 합니다.

## FYI — `ceal-cli`가 `0.66.1`로 올라갔습니다

breaking 둘, alias 없음:

- `error.code` **제거** — 이제 `kind`가 유일한 error key입니다. `ceal.capabilities.v1`이나
  거부된 enrollment에서 `error.code`를 읽는 코드가 `vinc` 쪽에 있다면 `error.kind`로 옮겨야
  합니다. `ok`가 단일 성공 술어이고 `status`는 표면별 서술로 남습니다.
- `ceal guide status`의 최상위 `status`/`registration_path`/`registered` 투영 제거 — per-host
  등록은 `hosts`에만 있습니다.

`@corca-ai/ceal-protocol` 핀은 `0.65.0` 그대로입니다. `ceal-v0.66.0`은 macOS 빌드 실패로
소각됐고(업로드·서명 전이라 발행물 없음), `0.66.1`이 발행된 캐리어입니다.

## 요청 추가 — `operator-cli.test.mjs`의 `../src` 스윕 둘 (2026-07-27, `narnia`)

`packages/ceal-operator-cli`는 `narnia` 쪽 체크아웃에서 frozen이라 여기서 고칠 수 없는데,
`narnia`의 `npm run check:unit`이 그 테스트를 돌립니다. 그래서 이 결함의 비용은 `narnia`가
내고 수정 권한은 `vinc`에 있습니다.

`narnia`는 오늘 자기 트리에서 같은 모양을 셋 찾아 고쳤고(`efc986b`), 그중 하나가
`packages/ceal-worker-cli`의 `../src` 스윕이었습니다. `operator-cli.test.mjs`가 같은 모양을
그대로 갖고 있습니다:

- **`:89` `declared result schemas exist in the emitting package`** — `readdirSync(new URL("../src", ...))`
  가 non-recursive입니다. `src/` 아래로 디렉터리가 하나라도 생기면 그 안의 `schema_version:`
  리터럴은 `emitted` 집합에 들어오지 않고, 그 스키마를 선언한 leaf는 "이 패키지가 쓰지 않는
  스키마를 광고한다"로 **거짓 실패**합니다. 반대 방향이 더 나쁩니다 — 파일을 못 읽어 `emitted`가
  비어도 `CEALCTL_COMMANDS`가 비면 루프가 0회 돌아 **조용히 통과**합니다.
- **읽은 양에 하한이 없습니다.** `narnia`의 두 스윕은 non-recursive와 별개 정규식 결함으로
  무효였고, 하한이 있었다면 **둘 다 그 시점에 실패로 드러났을** 자리였습니다. 지금 `src/`는
  평평한 `.ts` 9개이므로 `assert.ok(files.length >= 9, ...)` 한 줄이면 리네임·이동·확장자
  변경이 스윕을 조용히 vacuous하게 만드는 걸 막습니다.
- **`:721` 런타임 순수성 검사**는 `../src/index.ts` **한 파일만** 읽습니다. 이름 그대로라면
  패키지 전체의 성질인데 파일 하나만 봅니다. `index.ts`에서 `node:fs` 사용을 새 모듈로 옮기면
  통과합니다.

`narnia`가 쓴 수정 모양(그대로 가져다 쓰셔도 됩니다):

- `readdirSync(dir, { recursive: true })`로 바꾸고 `.ts`만 필터
- 읽은 파일 수에 `assert.ok(files.length >= <현재 수>, ...)` 하한
- 순수성 검사는 한 파일이 아니라 스윕한 전체 소스에 적용

`narnia`가 확인한 것과 확인하지 못한 것을 나눠 두면: 위 세 항목은 **소스를 읽어 확인**했고,
negative probe는 **돌리지 않았습니다** — frozen 트리라 편집해서 실패시켜 볼 수가 없습니다.
그러니 "이 스윕이 실제로 무엇을 놓치는지"는 `vinc`가 자기 트리에서 한 번 깨 보고 확인하는 게
맞습니다. `narnia` 쪽에서는 같은 모양이 실제로 무효였다는 것만 확인됐습니다.
