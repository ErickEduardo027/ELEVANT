import { isReceived } from '../../dashboard/noc/alertModel';

// The count plates of the OCC rail (design C.2), from the operational notices the shell already read
// (OperationalNotificationResponse; no read of its own). Each key is the id of the module that shows the count.
// A notice with `readAt` was read by the account: its per-account read receipt, the «Recibido» of the alerts.

/** The most a plate spells out; above it the plate says «99+». */
export const COUNT_PLATE_LIMIT = 99;

/**
 * How many unread notices each module of the rail announces: `chat` the messages from agents, `approvals` (Revisión)
 * the operations handed off for review, and `notifications` every unread notice. A missing or malformed list counts
 * nothing.
 */
export function railBadges(items) {
  const badges = { chat: 0, approvals: 0, notifications: 0 };
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || isReceived(item)) continue;
    badges.notifications += 1;
    if (item.kind === 'agent_message') badges.chat += 1;
    else if (item.kind === 'operation_submitted') badges.approvals += 1;
  }
  return badges;
}

/** The text of a count plate: the number up to COUNT_PLATE_LIMIT, then «99+». */
export function countPlateText(count) {
  return count > COUNT_PLATE_LIMIT ? `${COUNT_PLATE_LIMIT}+` : String(count);
}
