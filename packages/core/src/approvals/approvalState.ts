import type { LedgerEvent, PendingApproval } from "../schemas/index.js";

/**
 * Scans ledger events and returns all approvals currently awaiting a human decision.
 * An approval is "pending" when HUMAN_APPROVAL_REQUESTED exists for a task
 * but neither HUMAN_APPROVAL_GRANTED nor HUMAN_APPROVAL_REJECTED has followed.
 */
export function getPendingApprovals(events: LedgerEvent[]): PendingApproval[] {
  const requested = new Map<string, LedgerEvent>(); // taskId → request event
  const resolved = new Set<string>(); // taskIds that have a grant or reject

  for (const event of events) {
    const taskId = event.task_id;
    if (!taskId) continue;

    if (event.event_type === "HUMAN_APPROVAL_REQUESTED") {
      requested.set(taskId, event);
    } else if (
      event.event_type === "HUMAN_APPROVAL_GRANTED" ||
      event.event_type === "HUMAN_APPROVAL_REJECTED"
    ) {
      resolved.add(taskId);
    }
  }

  const pending: PendingApproval[] = [];

  for (const [taskId, requestEvent] of requested) {
    if (resolved.has(taskId)) continue;

    const payload = requestEvent.payload;
    pending.push({
      runId: requestEvent.run_id,
      taskId,
      requestedAt: requestEvent.timestamp,
      reasons: Array.isArray(payload["reasons"])
        ? (payload["reasons"] as string[])
        : [],
      filesModified: Array.isArray(payload["filesModified"])
        ? (payload["filesModified"] as string[])
        : [],
      summary: typeof payload["summary"] === "string" ? payload["summary"] : "",
    });
  }

  return pending;
}

/**
 * Returns true if the task has a HUMAN_APPROVAL_GRANTED event and no subsequent
 * HUMAN_APPROVAL_REJECTED (i.e., it's safe to proceed with verification).
 */
export function isApproved(events: LedgerEvent[], taskId: string): boolean {
  let granted = false;
  let rejected = false;

  for (const event of events) {
    if (event.task_id !== taskId) continue;
    if (event.event_type === "HUMAN_APPROVAL_GRANTED") granted = true;
    if (event.event_type === "HUMAN_APPROVAL_REJECTED") rejected = true;
  }

  return granted && !rejected;
}

/**
 * Returns true if the task has been explicitly rejected.
 */
export function isRejected(events: LedgerEvent[], taskId: string): boolean {
  return events.some(
    (e) => e.task_id === taskId && e.event_type === "HUMAN_APPROVAL_REJECTED",
  );
}

/**
 * Returns true if the task has a pending (unresolved) approval request.
 */
export function isAwaitingApproval(events: LedgerEvent[], taskId: string): boolean {
  const pending = getPendingApprovals(events);
  return pending.some((p) => p.taskId === taskId);
}
