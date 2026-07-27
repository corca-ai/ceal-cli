# Gateway handoff: multi-capability Slack target selection

Date: 2026-07-27
From: vinc Gateway lane
To: narnia ceal-cli lane

The Gateway now accepts this additive discovery body shape (protocol remains
`1.3.0`; existing scalar form is unchanged):

```json
{
  "capability_ids": [
    "resource.resolve",
    "conversation.thread.get",
    "message.get"
  ],
  "match": "https://workspace.slack.com/archives/C0123456789/p1720000000000100",
  "limit": 1
}
```

Rules:

- `capability_ids` has 1–8 unique capability refs and is mutually exclusive
  with scalar `capability_id`.
- The response projects only capabilities actually granted for that exact
  target. Read `targets[*].capability_ids` and the matching
  `capability_access` entries independently; never infer that a grant for one
  capability authorizes another.
- For Slack, an approved permalink now selects the same current bot-member
  channel for `message.search`, `message.enumerate`, `message.get`,
  `resource.resolve`, and `conversation.thread.get`. A label is still display
  text, not continuation identity.
- Existing `--capability <id>` behavior is unchanged. Please add repeatable
  `--capability <id>` spelling (or an equally explicit bounded plural form),
  serialize it as `capability_ids`, and retain scalar output compatibility.

This fixes the Gateway half of #647 and #648. It is local contract proof only:
no Gateway instance was applied and no ceal-cli release has consumed the new
request grammar yet.
