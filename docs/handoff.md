# Session Handoff
Date: 2026-07-28 — **계획 문서의 순서 1~6을 전부 끝냈다.** `v0.66.1`을 소비했고 발산이
닫혔고 가드가 치명적이 됐다. 축이 바뀌었다: 이제 남은 일은 이 레인의 backlog가 아니라
**게이트웨이의 사내 공지 순서 1단계**이고, 그건 단일 관문 하나에 걸려 있다.
**이 레인은 `corca-ai/ceal-cli`만 다룬다.**

## Workflow Trigger

- 이 파일만 언급되면 **먼저 `## The One Blocker`의 URL을 `curl`로 재고**, 200이면
  `charness:impl`로 릴리스 준비(`## Next Session` 1)를 시작한다. 404면 이 레인이 스스로
  진행할 릴리스 작업은 없다 — `## Unblocked Now`만 남는다.
- **재계획도 chunked routing도 돌리지 말 것.** 기본 라우팅은 backlog를 다시 랭킹하려 들고,
  아래 순서는 그 결과가 아니라 다른 레인의 공지 순서에서 유도된 것이다.
- `ceal capabilities --fresh`는 **실세션 readback**이라 승인 후에만. prod 세션 생사 판정에만
  `npm run probe`를 못 쓴다(설치 표면 포크는 여전히 probe만).

## The One Blocker

**`v0.66.1` 핸드오프 아카이브가 릴리스 오리진에 없다.** 2026-07-28 측정:

```
200  https://ceal.borca.ai/releases/gateway-handoff/gateway-handoff-v0.65.0/ceal-gateway-handoff-0.65.0.tar.gz
404  https://ceal.borca.ai/releases/gateway-handoff/gateway-handoff-v0.66.1/ceal-gateway-handoff-0.66.1.tar.gz
```

릴리스 워크플로는 아카이브를 **자격증명 없이 공개 오리진에서 `curl`**한다. `vinc`가 준
`gh run download` 경로는 사람이 로컬에서 받을 때만 통하고 CI는 못 쓴다. 404인 채로 태그를
밀면 다운로드 단계에서 죽고 **태그가 탄다**(`0.65.8`·`0.66.0`이 그렇게 죽었다).
게시 요청은 [전달 완료](requests/2026-07-28-to-gateway-lane-publish-handoff-archive-to-release-origin.md).

**200이 되기 전엔 릴리스 태그를 밀지 않는다.** 그리고 이건 공지 1단계 전체를 막는다:
lock을 rebind했으므로 옛 lock으로 빌드된 릴리스는 우리 acceptance 스크립트가
`protocol_provenance_disagreement`로 거부한다(설계대로). 즉 fresh install 증거에는
**새 lock으로 빌드한 새 워커 릴리스**가 필요하다.

## Next Session

1. **릴리스 준비**(아카이브가 200이 된 뒤). 버전 결정(`ceal-v0.66.1` 소진 → 다음 번호),
   CHANGELOG, 그리고 **태그 push 승인**. 워크플로의 handoff env는 이미 lock을 가리키고,
   어긋나면 게이트가 붉어진다.
2. **설치 증거**(1 이후, 승인 걸림): Linux amd64 fresh install → `guide status` →
   **새 enrollment**(현재 prod 바인딩을 대체한다) → fresh discovery →
   `npm run accept:worker -- --sanitized` → 레코드 커밋.
   경로 `docs/acceptance/<tag>/<platform>.json`은 **제안 상태**, `vinc` 확인 대기.
3. **`vinc` 답 대기 둘**: 아카이브 게시(위), 그리고 sanitize 시 `instance_ref`/`profile_ref`가
   필요한지. 후자는 기본값을 **유지**로 골라 구현해 뒀으니 답이 다르면 한 줄이다.
   **답은 `git fetch`로 안 온다** — `oc:~/ceal`의 untracked 노트를 직접 볼 것. 그리고
   **`oc`의 로컬 커밋도 볼 것**(`git log origin/main..HEAD`): 오늘 노트가 사라진 줄 알고
   재전달했는데, 실은 읽히고 커밋으로 처리돼 있었다. untracked만 보면 그걸 놓친다.
4. **보류**: write-receipt readback은 v0.66.1이 **아직 안 받는다**(확인함), attachment는 원문이
   **구현 금지**, `corca-ai/ceal#633`은 `vinc` 대기이며 **명시적 go 없이 시작 금지**(prod 바인딩 파괴).

## Unblocked Now

아카이브와 무관하게 이 레인이 지금 할 수 있는 일은 사실상 없다 — 계획 순서가 소진됐다.
새 일감이 필요하면 `Debt`에서 고르되, `createLock` 경합이 유일하게 자기완결적이다.

## Current State

- **`v0.66.1` 소비 완료**: 아카이브를 Actions에서 직접 받아 **다섯 digest를 독립 검증**했다 —
  archive `493b8e8d…`, 내부 manifest `5e59d7d6…`, protocol tarball `3f92a942…`,
  client tarball `7dca358d…`, 인벤토리 6멤버. lock·vendored 사본(`ac602cc1…`)·pin을 한 커밋으로.
  **확인 안 한 것**: cosign 서명·인증서.
- **발산이 닫혔다.** pin은 `agreed`. 판정은 이제 **`source.commit` 대 `lock.gateway.commit`**
  (pin이 못 쓰는 유일한 식별자). 한계: `source.commit`도 자가 기록이라 **발산은 탐지되지만
  수렴은 관측되지 않는다.**
- **가드가 치명적이다**(`proof_shipment_protocol_divergence`). release·packing·native·
  release-artifact·acceptance 다섯 경로가 각자 거부한다. `npm run check:protocol-dev`가
  개발 전용 경로이고 출력이 스스로 `development_only`를 찍는다.
- **소비가 동결 경로 셋을 건드리게 했다**(`operator-cli` 둘 + 미러된 `release-contract.json`).
  승인받아 편집했고 통보했으며 **`vinc`가 미러를 이미 동기화했다**(`oc` 로컬 `eb33f5177`,
  미푸시). 아티팩트를 소비할 때마다 재발한다 — 리포 분리 전까지.
- **`npm ci`가 깨졌다가 복구됐다.** vendored protocol이 0.66.1이 되자 소비자 셋이 레지스트리에
  없는 `0.65.0`을 받으러 가 404. 선언 버전을 아티팩트와 함께 올려야 한다. `*`로 푸는 건
  **틀린 답**이다 — `protocol_version_mismatch`와 공개 패키지 exact 규칙 둘을 끈다.
- **2026-07-28 측정**(인용 말고 다시 잴 것): `check` 45.2~47.2s, `check:unit` 21.4s(36코어).

## Discuss

- **미푸시 커밋** — `git log @{u}..HEAD`로 **재서** 말할 것. 세지 말 것.
- 공지 순서 1단계가 새 릴리스를 요구한다는 사실은 **게이트웨이 순서에 안 적혀 있다.** 전달했다.

## Debt

- **동결 경로 우회가 좁아졌다.** `packages/ceal-protocol`을 편집하고 `source.tree`만 올리면
  이제 `invalid_protocol_vendor_pin`으로 죽는다(커밋은 lock과 같은데 트리가 갈리므로).
  남은 구멍: `shipped.protocol_tree`까지 함께 위조하면 통과한다 — **두 필드를 고의로 거짓
  기재해야** 하므로 우발적 경로는 아니다. 여전히 vendored 바이트를 owner 산출물과 대조하는
  것은 아무것도 없다.
- **요구 3에 행위 테스트가 없다.** 다섯 경로의 거부는 `repo-gates.test.mjs`의 **소스 형태
  게이트**로만 붙들려 있다(호출부가 사라지면 붉어진다). live pin이 수렴 상태라 행위로는
  falsify가 안 된다 — 다음 발산 때 진짜 테스트를 붙일 것.
- **worker `createLock`의 잔여 경합은 이 레인 소유이고 미해결**(claim 없는 디렉터리 교체,
  inode 20/20 재사용). Gateway가 가져간 건 **cealctl 쪽**이다.
- **CI에 macOS 설치 레그가 없다.** 빌드·서명은 네 플랫폼 다 된다(`ceal-release.yml:50-61`);
  없는 건 darwin 릴리스를 **설치해서** 패킷을 돌리는 레그다. `require_platform_proofs: "0"`은
  릴리스·설치기 **테스트 스위트** 얘기라 이 공백의 근거로 인용하면 틀린다.
- 나머지(가드가 수렴을 관측 못 하는 한계, update 파이프 해제 미게이트, 설치기 `curl` 변수 호출
  우회, drop count 하한, 관측기 HTML 검사)는 해당 주석·[gates.md](gates.md)·품질 리뷰가 소유한다.

## References

- [Gateway 레인 답·계약](requests/from-gateway-lane/) — **원문이 authoritative**. 2026-07-28
  아카이브 소비 노트가 막혔던 두 값을 다 줬다.
- [계획 문서](../charness-artifacts/impl/2026-07-28-post-v0.66.1-plan.md) — 순서 1~6의 근거.
  **소진됐다**; 남은 유효 내용은 "뒤집은 판단 셋"과 항목별 상세뿐이다.
- [게이트 상세](gates.md) · [릴리스·재등록 절차](release-and-enrollment.md) ·
  [운영자 수용 천장](operator-acceptance.md) · [품질 리뷰 3차](../charness-artifacts/quality/latest.md)
