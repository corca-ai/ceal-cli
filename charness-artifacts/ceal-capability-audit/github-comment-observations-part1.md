## Ceal capability 전수조사 관찰 기록 (2026-08-05) — 관찰 1/2

이 comment는 `ceal`만으로 실행한 라이브 조사 결과다. raw provider CLI/API/browser는 사용하지 않았다. 전체 상세 artifact: `charness-artifacts/ceal-capability-audit/2026-08-05-live-audit.md`.

### 표면과 판정

`ceal capabilities --profile profile:work --fresh --detail`은 Gateway `instance:ceal-prod`, protocol `1.3.0`, target catalog 362개, live capability 20개를 반환했다. 구성은 read 17개 + append-only write 3개다. Discovery 자체의 proof는 `host_decision`이고 provider 실행까지 갔다는 뜻이 아니다.

20개를 빠짐없이 다뤘다: `calendar.availability` readback, `calendar.event.get` readback, `calendar.event.search` readback, `conversation.thread.get` readback, `drive.file.search` readback, `github.issue.comment.create` 기존 write readback 및 이번 보고 write, `github.issue.get` readback, `github.pull_request.get` connector_unavailable, `github.repository.get` readback, `github.repository.search` readback, `github.workflow_run.get` connector_unavailable, `message.create` safety_skipped, `message.enumerate` readback, `message.get` readback, `message.search` readback, `notion.page.comment.create` 기존 write readback, `notion.page.get` readback, `notion.search` readback, `resource.resolve` 부분 성공/부분 Gateway rejection, `sheets.values.read` readback.

### 실제로 가능했던 것

- Notion 지정 URL은 resolve 성공(`notion-page:dea1aad00fb1e2695cbda106dc181d3890fe`). `notion.page.get(with_blocks=true)`는 `Ceal HOTL 테스트`, archived false, content completeness complete, `blocks: []`를 반환했다. `notion.search(Ceal HOTL)`는 4개 결과를 complete first page로 반환했다.
- Notion comment append는 이전 안전 테스트에서 idempotency `ceal-verify-notion-20260805`, comment ref `notion-comment:f337d82a3bb32e62ecaa1d3e01852d90`, provider readback/receipt verified였다.
- Calendar 두 target을 읽었다. 2026-08-05 하루 availability는 첫 target busy 없음, 두 번째 target 하루 전체 busy. 두 번째 search에서 `🌴 [김원섭] 휴가`를 찾고 event.get으로 confirmed event를 다시 읽었다.
- Drive 메타데이터 검색 `name_contains=Ceal`은 PDF와 Keynote 2개를 complete/truncated false로 반환했다.
- generic 승인 Sheet target `target:sheets:448ba8a4d8717d6914f7178f`의 `A1:C5` read는 5 rows/12 cells readback verified였다.
- GitHub repository search는 `repository:corca-ai/ceal`을 포함한 5개를 반환했고, repository.get은 private, main, archived false, fork false를 확인했다. issue.get #11도 readback했다.
- Slack read는 모두 동작했다. enumerate 5개 + opaque cursor 1 page continuation, search 5개 + offset 5 continuation, message.get 1개 full text, conversation.thread.get 4개 complete message를 읽었다. attachments-only 상태도 보존됐다.
- GitHub issue comment append는 이전 summary comment가 첫 rate limit 뒤 retry 성공했다. provider readback verified, `github-comment:3392d93549c0c36f108bb7538fb5b4f5`.

관찰 2/2에는 불가능/미도달/제외, rate limit과 unknown, 낭비와 개선을 이어서 기록한다.
