## Ceal capability 전수조사 관찰 기록 (2026-08-05) — 관찰 2/2

### 불가능/미도달/명시적 제외

- Notion 본문·블록·title/property 수정 capability가 없다. `page.get`의 빈 blocks는 쓰기 가능을 의미하지 않는다. 현재 가능한 Notion write는 comment append뿐이다.
- Drive folder URL `https://drive.google.com/drive/u/0/folders/0AKQH0oI98roMUk9PVA`는 `resource.resolve` target selection이 initial/retry 모두 `gateway_request_failed`; 응답은 provider action/production audit custody 미도달이라고 했다. 업로드/삭제는 실행하지 않았다. 더구나 catalog에 upload/create/delete capability 자체가 없다.
- 지정 Sheet URL `https://docs.google.com/spreadsheets/d/1f-9i_Lli7JX4VaoI1LfDo_x-kQd48FH23JVcujssj2Y/edit?usp=drive_link`도 resource target selection이 initial/retry 모두 같은 Gateway rejection이었다. named file readback은 없다. catalog에 Sheet write도 없다.
- GitHub PR get과 workflow run get은 각각 `connector_unavailable` (exit 3), provider readback 없음. issue create, issue body/title/label/state 수정 capability도 없다.
- Slack `message.create`는 사용자의 별도 검토 요청에 따라 실제 실행하지 않았다. write contract/target selection만 확인했고 `safety_skipped`다.

### 실패·rate limit·unknown 처리

- 과거 GitHub summary comment 첫 호출은 `rate_limited`; retry 후 성공. 이번 read-only run에서는 rate limit이 새로 발생하지 않았다.
- 과거 긴 detailed GitHub comment는 여러 번 `invalid_request` + `outcome_unknown`이었다. request ref `ceal:e164a370-9b1a-4267-8c6d-ac09cbdbd4a3:call`, `ceal:f972c403-54df-4723-8414-681fbdae8513:call`을 receipt show했지만 모두 `audit_event_not_found`. 따라서 detailed report가 게시됐다고 주장하지 않는다.
- 이전 `charness:issue` 경로가 sandbox에서 raw `gh`를 호출하려 했던 routing 문제는 기존 issue #11 본문에도 기록돼 있다. 이번 report는 raw `gh`로 우회하지 않았다.

### 낭비와 개선

1. 초기 run은 wrapper가 없어 duration/response bytes가 사라졌다. 이번 run은 모든 명령을 wrapper로 실행했다.
2. 현재 resolve ref를 받기 전에 stale Notion ref로 page.get을 한 번 중복 호출했다. 이후 resolve가 준 ref로 다시 읽었다. 다음에는 resolve 결과를 즉시 보존한다.
3. 8192-byte write contract를 사전 확인하지 않고 긴 comment를 시도한 것이 `invalid_request`와 재시도를 만들었다. 다음에는 byte limit 선측정 후 한 번만 쓴다.
4. GitHub가 특히 느렸다: repository.search 22.7s, PR 실패 22.6s, issue.get 26.5s, repository.get 29.3s, workflow 실패 29.6s.
5. Drive/Sheet URL target selection이 같은 Gateway rejection을 반복하면 Gateway 상태 변화 전에는 재시도하지 않는다.

관찰 1/2와 함께 읽어야 전체 provider별 관찰이 완성된다. command별 수치는 별도 `metrics` comment에 남겼다.
