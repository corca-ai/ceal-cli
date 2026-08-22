// Side-effect import for a `dist`-binding suite: refuses to run outside the
// source lane. `test/source-lane.ts` owns the reasoning and the message.
//
// This exists as its own module so a suite declares the requirement in one
// unmissable line — `import "../../../test/require-source-lane.ts";` — rather
// than importing a helper and being expected to remember to call it.
import { assertSourceLane } from "./source-lane.ts";

assertSourceLane();
