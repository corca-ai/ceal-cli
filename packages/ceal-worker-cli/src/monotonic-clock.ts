import { performance } from "node:perf_hooks";

export const defaultMonotonicNow = () => performance.now();
