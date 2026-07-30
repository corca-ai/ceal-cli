# Worker Test Runner Carrier Hang Spec Handoff

The worker test's final leased-consumer carrier case hangs only under the Node
test runner on macOS with Node v22.22.1. Its `spawnSync` child invocation
returns outside the test runner. The next implementation slice should replace
or bound that synchronous subprocess test and verify the focused test, worker
unit gate, and root test gate on the target Node versions.
