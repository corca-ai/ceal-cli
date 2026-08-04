# Ceal capability 전수조사 관찰 기록

- 실행일: 2026-08-05 (Asia/Seoul)
- 실행 위치: `/home/hwidong/codes/ceal-cli`
- 프로필: `profile:work`
- Gateway: `instance:ceal-prod`, negotiated protocol `1.3.0`
- 방법: 모든 Ceal 명령을 `skills/ceal-capability-audit/scripts/measure_ceal.py`로 감싸 실행
- 측정값: `local_elapsed_ms`는 로컬 subprocess wall-clock, `stdout_bytes`/`stderr_bytes`는 정확한 바이트 수, `estimated_stdout_tokens=ceil(stdout_bytes/4)`는 응답 크기의 거친 추정치
- 금지/제외: raw provider CLI/API/browser를 사용하지 않음. Slack `message.create`는 사용자의 별도 검토 요청에 따라 실제 실행하지 않음.

## 결론을 먼저 적으면

현재 라이브 capability 카탈로그는 20개뿐이다. 읽기 17개와 append-only 쓰기 3개로 구성되어 있다.

- 실제 provider readback까지 확인: Calendar 읽기, Slack 읽기, Drive 메타데이터 검색, Notion resolve/search/page 읽기, Sheets bounded range 읽기, GitHub repository/search/issue 읽기, Notion comment append, GitHub issue comment append.
- Gateway까지 도달했지만 provider 실행 불가: `github.pull_request.get`, `github.workflow_run.get` (`connector_unavailable`).
- Gateway가 요청을 거절해 provider에 도달하지 않음: 지정한 Drive 폴더 URL과 지정한 Google Sheet URL의 `resource.resolve` target selection (`gateway_request_failed`). 재시도 후에도 동일했다.
- 표면에 capability 자체가 없음: Notion 본문/블록 수정, Google Drive 파일 업로드·삭제, Google Sheet 값 쓰기, GitHub issue 생성·본문 수정·라벨/상태 수정, Calendar 이벤트 생성/수정/삭제, Slack message.create 외의 메시지 수정/삭제 등.
- `notion.page.get(with_blocks=true)`는 페이지를 읽었지만 `blocks: []`를 반환했다. 본문을 쓸 수 있다는 뜻이 아니며, 현재 discovery에는 page/block update capability가 없다.

이 기록에서 `readback_verified`는 provider 결과가 반환되고 Gateway receipt까지 확인된 경우에만 사용했다. `host_decision`, `not_read_back`, `outcome_unknown`, `not_audited`를 성공으로 세지 않았다.

## 라이브 discovery와 capability 전체 목록

`ceal capabilities --profile profile:work --fresh --detail` 결과:

- target catalog: 362, selection required
- live capability: 20
- discovery proof: `host_decision`
- discovery non-claims: `provider_execution_not_reached`, `production_audit_not_reached`

| capability | effect | 이번 조사 결과 |
|---|---:|---|
| `calendar.availability` | read | provider readback verified (두 Calendar target) |
| `calendar.event.get` | read | provider readback verified |
| `calendar.event.search` | read | provider readback verified (두 Calendar target) |
| `conversation.thread.get` | read | provider readback verified |
| `drive.file.search` | read | provider readback verified |
| `github.issue.comment.create` | write | 기존 안전한 테스트가 provider readback verified; 이번 보고 comment에서 재검증 예정 |
| `github.issue.get` | read | provider readback verified |
| `github.pull_request.get` | read | `connector_unavailable`, provider 미도달 |
| `github.repository.get` | read | provider readback verified |
| `github.repository.search` | read | provider readback verified |
| `github.workflow_run.get` | read | `connector_unavailable`, provider 미도달 |
| `message.create` | write | 사용자 요청으로 safety_skipped, 실제 메시지 생성 안 함 |
| `message.enumerate` | read | provider readback verified; continuation 1회 추적 |
| `message.get` | read | provider readback verified |
| `message.search` | read | provider readback verified; offset continuation 1회 추적 |
| `notion.page.comment.create` | write | 기존 안전한 테스트가 provider readback verified |
| `notion.page.get` | read | provider readback verified |
| `notion.search` | read | provider readback verified |
| `resource.resolve` | read | Notion 성공; 지정 Drive/Sheet URL은 Gateway rejection |
| `sheets.values.read` | read | 다른 승인된 generic target의 `A1:C5` readback verified |

쓰기 contract는 세 가지 모두 `idempotency: required`, `dry_run: unsupported`, `compensation: irreversible`, `provider_readback: required`였다. 따라서 같은 테스트를 무의미하게 반복하지 않았고, 이미 readback이 확인된 Notion comment는 재실행하지 않았다.

## 요청한 provider별 관찰

### Notion

- 지정 URL을 `resource.resolve`하면 현재 ref `notion-page:dea1aad00fb1e2695cbda106dc181d3890fe`로 resolve됐다. source URL은 `app.notion.com/p/Ceal-HOTL-...`로 정규화됐다.
- `notion.page.get(with_blocks=true)`는 제목 `Ceal HOTL 테스트`, archived false, 마지막 수정 `2026-07-20T22:39:00.000Z`, `blocks: []`, content completeness `complete`를 반환했다.
- `notion.search(query=Ceal HOTL, limit=5)`는 4개 결과를 반환했고 `provider_has_more: false`, `complete_first_page`였다. 지정 페이지도 검색 결과에 포함됐다.
- 이전 안전 테스트에서 `notion.page.comment.create`는 `idempotency_key=ceal-verify-notion-20260805`로 성공했고, `comment_ref=notion-comment:f337d82a3bb32e62ecaa1d3e01852d90`, delivery/provider readback/receipt가 확인됐다. 당시 측정 wrapper가 없어서 해당 쓰기의 duration/response size는 `measurement_gap`이다.
- 본문 수정은 불가능했다. 현재 discovery에는 `notion.page.update`, `notion.block.update`, append block, title/property update가 없다. 가능한 쓰기는 페이지에 comment를 append하는 것뿐이다.

### Google

- Calendar 두 target(`Calendar Corca Team`, `Calendar Corca Team Calendar`)에 대해 availability와 event search를 실행했다. 첫 Calendar는 2026-08-05 하루 `busy_periods: []`; 두 번째는 하루 전체 busy였다.
- 두 번째 Calendar search가 `🌴 [김원섭] 휴가`를 반환했고, `calendar.event.get`으로 동일 event ref를 다시 읽었다. event get은 confirmed, 2026-08-05~06, provider URL까지 반환했다.
- Drive는 `drive.file.search(name_contains=Ceal)`가 성공해 PDF와 Keynote 메타데이터 2개를 완전하게 반환했다.
- 사용자가 준 Drive 폴더 URL은 `resource.resolve` target selection 단계에서 두 번(`initial`, `retry`) 모두 `gateway_request_failed`였다. 응답에 `No provider action or production audit custody was reached`가 명시됐다. 따라서 폴더에 빈 파일을 올렸다가 삭제하는 테스트는 실행되지 않았다.
- 현재 catalog에 `drive.file.create`, upload, delete, move가 없다. folder resolve가 복구되어도 upload/delete를 Ceal로 할 capability는 현재 표면에 없다.
- 사용자가 준 Sheet URL도 `resource.resolve` target selection 단계에서 두 번 모두 같은 `gateway_request_failed`였다. named Sheet target은 선택되지 않았고 provider readback도 없었다.
- 대신 target catalog에 있던 승인 generic Sheet `target:sheets:448ba8a4d8717d6914f7178f`에서 `sheets.values.read(range=A1:C5)`는 5 rows/12 cells를 readback했다.
- 현재 catalog에는 `sheets.values.write`, append, clear, create가 없다. 따라서 사용자가 지정한 Sheet 파일의 읽기·쓰기를 모두 검증할 수 없고, 실제로 검증한 것은 다른 승인 target의 read only뿐이다.

### GitHub

- `github.repository.search(query=corca-ai/ceal)`는 `repository:corca-ai/ceal`을 포함한 5개 결과를 반환했다. `github.repository.get`은 private, default branch `main`, archived false, fork false를 확인했다.
- `github.issue.get(number=11)`은 closed issue `$ceal:events --all output makes event scope, channels, and schedules hard to understand`를 읽었고 당시 comment_count는 2였다. 이 issue의 본문에도 과거 `issue` skill이 sandbox 안에서 `gh`를 직접 호출해 Ceal capability를 사용하지 못한 routing 문제가 기록되어 있다.
- 기존 `github.issue.get` #1~#12 탐색에서 #11을 report fallback 대상으로 선택했다. 새 issue 생성 capability는 없으므로 새 issue를 만들 수 없고, 관련 기존 issue에 comment를 append하는 방식만 가능하다.
- `github.issue.comment.create`의 이전 짧은 summary comment는 첫 시도에서 `rate_limited`를 겪은 뒤 재시도해 provider readback verified, `comment_ref=github-comment:3392d93549c0c36f108bb7538fb5b4f5`, receipt verified가 됐다. 이전 실행이라 duration/response size는 `measurement_gap`이다.
- 같은 이전 실행에서 긴 detailed report comment는 여러 번 `invalid_request`와 `receipt.evidence=outcome_unknown`을 반환했다. 두 request ref(`ceal:e164a370-9b1a-4267-8c6d-ac09cbdbd4a3:call`, `ceal:f972c403-54df-4723-8414-681fbdae8513:call`)를 나중에 `receipt show`했지만 모두 `audit_event_not_found`였다. 따라서 그 detailed report가 GitHub에 게시됐다고 주장하지 않는다. 현재는 Gateway가 그 호출을 provider 실행으로 기록하지 않았다고만 말할 수 있다.
- `github.pull_request.get(number=1)`과 `github.workflow_run.get(run_id=1)`은 둘 다 `connector_unavailable`이었다. Gateway receipt에는 request audit ref는 있었지만 provider readback은 없었다.
- issue comment는 append-only다. issue create, issue body/title edit, label/state edit, PR merge/update, workflow 실행/재실행 capability는 현재 없다.

## Slack 범위와 제외

사용자가 별도로 검토한 Slack `message.create`는 이번 report에서 실제 실행하지 않았다. target selection과 write contract만 확인했고 결과는 `safety_skipped`이다. 메시지를 생성하지 않은 것은 실패가 아니라 명시적 scope 제외다.

나머지 Slack read capability는 모두 확인했다.

- `message.enumerate`는 `Slack #agentic-engineering`에서 5개를 반환하고 opaque cursor를 제공했다. cursor를 한 번 더 사용해 5개를 추가로 읽었다.
- `message.search(query=Daily Code Quality Metrics)`는 5개씩 두 page를 읽었고, coverage는 각 page가 `truncated: true`인 bounded projection이었다. 즉 전체 Slack 검색 결과가 아니라 10개 page 관찰이다.
- `message.get`은 첫 message를 full text로 다시 읽었다.
- `conversation.thread.get`은 4개 message가 있는 thread를 complete로 읽었다. attachments-only 메시지도 content state로 표시됐다.

## 실패·불가능·불확실성 분류

- `capability_absent`: Notion body/block write, Drive upload/delete, Sheet write, GitHub issue create/edit, Calendar write, 기타 provider mutation.
- `connector_unavailable`: GitHub PR read, GitHub workflow run read.
- `gateway_request_failed`: 지정 Drive folder URL과 지정 Sheet URL의 resource target selection. provider action 없음.
- `rate_limited`: 과거 GitHub summary comment 첫 시도. retry 후 성공. 현재 측정 run의 read calls에서는 rate limit이 없었다.
- `outcome_unknown`: 과거 긴 GitHub detailed comment 시도. receipt readback이 `audit_event_not_found`으로 끝났으므로 provider 실행을 주장하지 않음.
- `measurement_gap`: wrapper 도입 전의 Notion comment, GitHub summary comment, 이전 Calendar/Drive/Sheet/GitHub read 및 이전 target selection. 이 기록에는 모르는 숫자를 채우지 않았다.

## 낭비와 개선점

1. 초기 실행들은 per-command wrapper 없이 실행되어 duration/response bytes를 잃었다. 이번에는 모든 명령을 wrapper로 감쌌다.
2. 새 resolve 결과를 받은 뒤 실수로 이전 Notion ref로 `notion.page.get`을 한 번 먼저 호출했다. 같은 페이지에 대한 중복 read였고, 곧바로 현재 resolve가 반환한 ref로 다시 읽었다. 다음 skill 실행에서는 resource resolve 결과를 변수처럼 보존해 stale ref 호출을 막아야 한다.
3. 긴 GitHub detailed comment를 한 번에 보내고, `invalid_request/outcome_unknown` 뒤에 재시도했다. receipt가 `audit_event_not_found`임을 확인하기 전 새 idempotency key를 만들지 않았고, 최종적으로 그 comment를 성공으로 분류하지 않았다. 다음에는 8192-byte contract를 사전 측정하고, report를 local artifact와 GitHub comment 크기에 맞게 분할/축약한 뒤 한 번만 실행해야 한다.
4. GitHub provider가 느렸다. 현재 측정에서 repository.get 29.3s, workflow get 실패 29.6s, issue.get 26.5s, repository.search 22.7s였다. read path별 timeout/connector health를 별도 관찰해야 한다.
5. 지정된 Drive/Sheet URL은 provider 호출까지 못 갔으므로 같은 target selection을 계속 반복하는 것은 의미가 없다. Gateway 상태가 바뀌었다는 증거가 있을 때만 재시도한다.
6. default `charness:issue` adapter는 `gh` backend를 선택할 수 있었지만, 이번 검증 목적은 Ceal을 통한 GitHub였으므로 raw `gh` fallback을 사용하지 않았다. 이 차이를 보고서에 명시하지 않으면 “GitHub issue 작성 가능”을 잘못 주장하게 된다.

## 명령별 측정 ledger

`stdout`은 wrapper가 캡처한 Ceal 표준출력이며, stderr는 wrapper metric을 제외한 명령 stderr이다. token은 비용 청구량이 아니라 응답 크기 추정치다.

### help/version/discovery

| label | ms | stdout B | stderr B | est tokens | outcome |
|---|---:|---:|---:|---:|---|
| help-root | 65.337 | 1071 | 0 | 268 | ok |
| help-capabilities | 63.793 | 1263 | 0 | 316 | ok |
| help-targets | 83.641 | 1565 | 0 | 392 | ok |
| help-call | 51.358 | 1042 | 0 | 261 | ok |
| help-receipt | 70.679 | 724 | 0 | 181 | ok |
| version | 64.080 | 204 | 0 | 51 | 0.72.9 / protocol 1.3.0 |
| live-discovery-detail (first) | 21799.173 | 13574 | 0 | 3394 | host_decision |
| live-discovery-detail-reread | 10063.817 | 13574 | 0 | 3394 | host_decision |
| help-call-current | 44.426 | 1042 | 0 | 261 | ok |
| help-targets-current | 42.733 | 1565 | 0 | 392 | ok |
| help-receipt-current | 66.216 | 734 | 0 | 184 | ok |

### target selection

| label | ms | stdout B | stderr B | est tokens | outcome |
|---|---:|---:|---:|---:|---|
| target-calendar-availability | 2044.485 | 2395 | 0 | 599 | targets 2 |
| target-calendar-event-get | 1599.776 | 2377 | 0 | 595 | targets 2 |
| target-calendar-event-search | 1603.916 | 2391 | 0 | 598 | targets 2 |
| target-conversation-thread-get | 1945.038 | 2132 | 0 | 533 | target 1 + cursor |
| target-drive-search | 1977.680 | 1989 | 0 | 498 | target 1 |
| target-github-repository-search | 11094.771 | 2025 | 0 | 507 | installation target |
| target-github-repository-get | 9550.557 | 2116 | 0 | 529 | repo target + cursor |
| target-github-issue-get | 9551.302 | 2091 | 0 | 523 | repo target + cursor |
| target-github-pr-get | 8760.088 | 2126 | 0 | 532 | repo target + cursor |
| target-github-workflow-get | 9349.839 | 2126 | 0 | 532 | repo target + cursor |
| target-github-comment | 9634.325 | 2150 | 0 | 538 | repo target + cursor |
| target-message-enumerate | 1920.985 | 2104 | 0 | 526 | Slack target + cursor |
| target-message-get | 1599.609 | 2073 | 0 | 519 | Slack target + cursor |
| target-message-search | 1688.745 | 2073 | 0 | 519 | Slack target + cursor |
| target-message-create-safety-only | 1511.014 | 2088 | 0 | 522 | write contract only |
| target-notion-page-get | 1853.156 | 1978 | 0 | 495 | target 1 |
| target-notion-comment | 1170.224 | 2023 | 0 | 506 | target 1 |
| target-notion-search | 1208.608 | 1981 | 0 | 496 | target 1 |
| target-resource-notion | 1199.548 | 1984 | 0 | 496 | target 1 |
| target-resource-drive-folder | 1500.990 | 523 | 0 | 131 | gateway_request_failed |
| target-resource-sheet | 1152.213 | 523 | 0 | 131 | gateway_request_failed |
| target-sheets-read | 1683.965 | 5828 | 0 | 1457 | targets 10 |
| target-resource-drive-folder-retry | 1219.773 | 523 | 0 | 131 | gateway_request_failed |
| target-resource-sheet-retry | 1174.168 | 523 | 0 | 131 | gateway_request_failed |

### provider calls

| label | ms | stdout B | stderr B | est tokens | outcome |
|---|---:|---:|---:|---:|---|
| resolve-notion-current | 1992.336 | 807 | 0 | 202 | readback_verified |
| notion-page-current (stale ref) | 2202.959 | 954 | 0 | 239 | readback_verified; redundant |
| notion-page-resolved-current | 2886.693 | 954 | 0 | 239 | readback_verified |
| notion-search-current | 2073.025 | 2106 | 0 | 527 | readback_verified |
| drive-search-current | 2644.707 | 1030 | 0 | 258 | readback_verified |
| sheets-read-current | 3357.766 | 1209 | 0 | 303 | readback_verified |
| calendar-availability-1-current | 3239.269 | 692 | 0 | 173 | readback_verified |
| calendar-availability-2-current | 3601.507 | 765 | 0 | 192 | readback_verified |
| calendar-search-1-current | 3588.727 | 825 | 0 | 207 | readback_verified |
| calendar-search-2-current | 3607.831 | 994 | 0 | 249 | readback_verified |
| calendar-event-get-current | 2821.536 | 902 | 0 | 226 | readback_verified |
| message-enumerate-current | 2416.057 | 3266 | 0 | 817 | readback_verified |
| message-search-current | 6095.370 | 3464 | 0 | 866 | readback_verified |
| message-enumerate-continuation-current | 2914.179 | 2860 | 0 | 715 | readback_verified |
| message-search-continuation-current | 6791.774 | 3438 | 0 | 860 | readback_verified |
| message-get-current | 2424.427 | 944 | 0 | 236 | readback_verified |
| conversation-thread-current | 2777.452 | 1778 | 0 | 445 | readback_verified |
| github-repository-search-current | 22677.848 | 1630 | 0 | 408 | readback_verified |
| github-repository-get-current | 29325.897 | 791 | 0 | 198 | readback_verified |
| github-issue-get-current | 26484.087 | 2620 | 0 | 655 | readback_verified |
| github-pr-get-current | 22595.442 | 619 | 0 | 155 | connector_unavailable / exit 3 |
| github-workflow-get-current | 29579.306 | 619 | 0 | 155 | connector_unavailable / exit 3 |

### receipt/readback of prior unknown report attempts

| label | ms | stdout B | stderr B | est tokens | outcome |
|---|---:|---:|---:|---:|---|
| receipt-old-detailed-1 | 772.955 | 484 | 0 | 121 | `audit_event_not_found`, exit 3 |
| receipt-old-detailed-2 | 752.007 | 484 | 0 | 121 | `audit_event_not_found`, exit 3 |

이 ledger에는 wrapper를 사용한 명령만 수치가 있다. wrapper 이전 실행의 명령에는 숫자를 소급해 만들지 않고 `measurement_gap`으로 남겼다.

## 재현 가능한 다음 실행 규칙

1. `ceal capabilities --fresh --detail`로 live surface를 새로 읽는다.
2. capability별로 반드시 해당 capability의 target을 새로 선택한다. 다른 capability의 target ref를 재사용하지 않는다.
3. resolve 결과와 cursor는 다음 call의 입력으로 직접 보존하고 stale ref를 쓰지 않는다.
4. 모든 command는 measurement wrapper로 실행한다.
5. write는 explicit user scope, idempotency key, 최대 바이트 선확인, provider readback까지 있어야 성공으로 닫는다.
6. `connector_unavailable`, `gateway_request_failed`, `rate_limited`, `outcome_unknown`을 성공으로 합치지 않는다.
7. Slack `message.create`는 이번 audit의 explicit exclusion으로 유지한다.

## 이번 상세 보고의 GitHub 게시 기록

새 issue 생성 capability가 없으므로 기존 `corca-ai/ceal` issue #11에 세 comment를 append했다. 세 write 모두 `delivery: verified`, `provider_readback: verified`, `receipt.evidence: readback_verified`였고, 마지막 `github.issue.get(number=11)`에서 comment_count가 2에서 5로 증가한 것을 확인했다.

| label | body bytes | ms | stdout B | stderr B | est tokens | result |
|---|---:|---:|---:|---:|---:|---|
| github-report-observations | 5878 | 84.998 | 712 | 0 | 178 | `invalid_request`, `outcome_unknown`, no audit |
| receipt-report-observations-unknown | - | 1316.154 | 484 | 0 | 121 | `audit_event_not_found` |
| github-report-observations-retry-same-key | 5878 | 61.635 | 712 | 0 | 178 | `invalid_request`, `outcome_unknown`, no audit |
| receipt-report-observations-retry-unknown | - | 1179.457 | 484 | 0 | 121 | `audit_event_not_found` |
| github-report-metrics | 3138 | 10181.941 | 661 | 0 | 166 | readback verified, `github-comment:531da4bbe2fa7a211cdb359936670865` |
| github-report-observations-part1 | 3217 | 10545.618 | 661 | 0 | 166 | readback verified, `github-comment:b5ac38bb8a673430ccdb66d109fa9cdc` |
| github-report-observations-part2 | 2998 | 9904.923 | 661 | 0 | 166 | readback verified, `github-comment:1486256d8be407f4f972721ebd4b4f3a` |
| github-issue-report-readback | - | 8908.912 | 2620 | 0 | 655 | issue readback verified, comment_count 5 |

The first 5878-byte observation body failed before provider audit despite the discovered contract saying `text.max_bytes: 8192`. It did not leave a receipt audit event and was not counted as posted. The successful split sizes exposed a practical gateway/request boundary below the advertised contract and removed repeated long-body retries. This is an integration observation, not a claim that the documented contract is wrong.

## Skill implementation validation

- `quick_validate.py skills/ceal-capability-audit`: `Skill is valid!`
- `python3 -m py_compile skills/ceal-capability-audit/scripts/measure_ceal.py`: passed
- `file-arg-smoke`: intentionally passed a long file argument to root `ceal --help`; root help treated the extra argument as an unknown command (`exit 2`). This was a wrapper smoke mistake, not a provider call.
- `file-arg-smoke-valid`: leaf `ceal call --help` accepted the injected file argument and returned normal help (`local_elapsed_ms=44.917`, `stdout_bytes=1042`, `stderr_bytes=0`, estimated 261 tokens, exit 0). No provider action.
