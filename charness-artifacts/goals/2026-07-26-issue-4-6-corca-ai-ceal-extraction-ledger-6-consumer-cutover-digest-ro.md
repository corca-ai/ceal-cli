# Achieve Goal: corca-ai/ceal의 extraction ledger를 먼저 읽고, #6 consumer cutover의 목표 상태(패키지 버전+digest 하나 + 리허설된 rollback)와 #4가 만든 packaging/ceal-cli-source/ 드리프트를 소유자 우선으로 정리한다

Status: draft
Created: 2026-07-26
Activation: `/goal @charness-artifacts/goals/2026-07-26-issue-4-6-corca-ai-ceal-extraction-ledger-6-consumer-cutover-digest-ro.md`

This file is the living goal scratchpad. It becomes active only when the user
runs the activation command.

## Active Operating Frame

- Current slice: before shaping.
- Next action: run `/achieve @charness-artifacts/goals/2026-07-26-issue-4-6-corca-ai-ceal-extraction-ledger-6-consumer-cutover-digest-ro.md` to fill the Before-phase placeholders;
  activate only after pursue-readiness passes.
- Verification cadence: to be filled by the achieve Before-phase interview.
- Slice review packet: to be filled by the achieve Before-phase interview.
- History boundary: keep this frame current during the active run; move
  completed detail to `## Slice Log`, `## Operator Decision Queue`,
  `## Final Verification`, and `## Auto-Retro`.

## Goal

corca-ai/ceal의 extraction ledger를 먼저 읽고, #6 consumer cutover의 목표 상태(패키지 버전+digest 하나 + 리허설된 rollback)와 #4가 만든 packaging/ceal-cli-source/ 드리프트를 소유자 우선으로 정리한다

**Source handoff entry #5: 교차 저장소 둘, 둘 다 소유자 우선**

> (사본에 독립 편집 금지, 소유자 변경 후 검토된 sync).
>    `corca-ai/ceal`의 extraction ledger를 먼저 읽는다. (a) `#6` consumer cutover — Gateway가
>    만든 패키지 버전+digest 하나와 리허설된 rollback 쌍을 지목할 수 있게 되는 것이 목표.
>    (b) `#4`가 만든 드리프트 — **`corca-ai/ceal`의 `packaging/ceal-cli-source/`** 안 사본이
>    `agent`를 리터럴 `"codex"`로 타이핑하고, 거기 기록된 절차가 `guide register codex`를
>    지시한다. 이 저장소의 `packages/ceal-worker-cli/src/agent-guide.ts`는 **이미 올바르고 sync
>    원본**이다 — 로컬 파일을 고치려 들지 말 것.

## Non-Goals

- Not a release: no plugin version bump expected.
- Do not absorb adjacent handoff entries beyond the selected chunk.

## Boundaries

- In scope: `packages/ceal-worker-cli/src/agent-guide.ts`, `packaging/ceal-cli-source/`
- Portable per implementation-discipline: no host-specific assumption.
- Stop conditions: name on first discovery; do not guess.

## User Acceptance

*To be filled by the achieve Before-phase interview.*

## Agent Verification Plan

*To be filled by the achieve Before-phase interview.*

## Slice Plan

| Slice | Objective | Why Now | Expected Evidence | Status |
| --- | --- | --- | --- | --- |

## Operator Decision Queue

Record decisions, confirmations, credential actions, manual proof steps, and
external-boundary approvals discovered during the run when they do not block
safe local progress. Use `none — <reason>` when the queue is empty at closeout.

Queue item form:

- Decision: operator-only decision or confirmation needed
- Owner: operator or named human owner
- Why deferred: why the run did not stop immediately
- Unblock action: exact action or answer needed
- Revisit trigger: event, date, or proof boundary that reopens this

## Slice Log

## Context Sources

- Source: handoff entry #5 (교차 저장소 둘, 둘 다 소유자 우선) — see [docs/handoff.md](../../docs/handoff.md).
- Cited path: `packages/ceal-worker-cli/src/agent-guide.ts`
- Cited path: `packaging/ceal-cli-source/`
- Cited issue: #4
- Cited issue: #6

## Interview Decisions

*To be filled by the achieve Before-phase interview.*

## Plan Critique Findings

*To be filled by the achieve plan-critique pass.*

## Off-Goal Findings

## Final Verification

## User Verification Instructions

## Auto-Retro
