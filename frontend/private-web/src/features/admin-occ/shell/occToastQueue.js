import { alertPriority, compareAlertEntries } from '../../dashboard/noc/alertModel';
import {
  isMessageNotification, notificationKindLabel, notificationTargetPath,
} from '../../notifications/notificationKinds';
import { ADMIN_OCC_BASE_PATH } from '../navigation';

// The toasts of the OCC frame (design D27), pure: OccShellProvider keeps the queue in a reducer and OccShellOverlays
// draws it with occ-ui/OccToastStack.
//
// - At most three show at once, in the order they showed.
// - Each lives from the moment it shows: an urgent one 15 s, an attention one 10 s, a notice 8 s.
// - A new toast takes a free place. With none free, the oldest toast that is not urgent and came in an earlier read
//   gives way; when the three are urgent (or of the same read), the new one waits its turn and shows as soon as one
//   closes. Nothing pushes an urgent toast out, so it stays at least 15 s unless the controller closes it.
// - The new notices of one read are a burst: up to three get a toast each; with more, the two most pressing get one
//   and «Tienes {count} avisos operativos nuevos más.» with «Ver» stands for the rest.

/** How many toasts show at once. */
export const OCC_TOAST_LIMIT = 3;

/** How long a toast stays once it shows, by priority. */
export const OCC_TOAST_LIFETIME_MS = Object.freeze({ urgent: 15_000, attention: 10_000, notice: 8_000 });

export const EMPTY_TOAST_QUEUE = Object.freeze({ visible: Object.freeze([]), waiting: Object.freeze([]) });

const NOTIFICATIONS_PATH = `${ADMIN_OCC_BASE_PATH}/notifications`;

/** The id of a notice's toast, so that its receipt can take the toast away. */
export const noticeToastId = noticeId => `notice:${noticeId}`;

function requireNow(action) {
  if (!Number.isFinite(action?.now)) throw new TypeError(`occToastQueue: "${action?.type}" needs a numeric now`);
  return action.now;
}

const lifetimeOf = priority => OCC_TOAST_LIFETIME_MS[priority] ?? OCC_TOAST_LIFETIME_MS.notice;
const show = (toast, now) => Object.freeze({ ...toast, shownAt: now, expiresAt: now + lifetimeOf(toast.priority) });
const queue = (visible, waiting) => Object.freeze({ visible: Object.freeze(visible), waiting: Object.freeze(waiting) });

/**
 * The toasts for the notices that arrived in one read (OccShellProvider's arrivalsSince), most pressing first: each
 * `{ id, priority, message, code, action: { label, path } }`. A notice's toast reads «{tipo}, {código}»: `message` is
 * the kind and `code` the operation code, which the stack draws as a plate so it never breaks across lines. No message
 * toast while the chat is open: the chat shows them itself. `t` translates occShellMessages.
 */
export function arrivalToasts(arrived = [], { pathname = '', t, language = 'es' } = {}) {
  const entries = (arrived ?? [])
    .filter(notice => notice && !(pathname.includes('/chat') && isMessageNotification(notice.kind)))
    .map(notice => ({ id: notice.id, priority: alertPriority(notice.kind), notice }))
    .sort(compareAlertEntries);
  const shown = entries.length > OCC_TOAST_LIMIT ? entries.slice(0, OCC_TOAST_LIMIT - 1) : entries;
  const toasts = shown.map(({ id, priority, notice }) => ({
    id: noticeToastId(id),
    priority,
    message: notificationKindLabel(notice.kind, language),
    code: notice.operationCode || null,
    action: { label: t('arrivals.open'), path: notificationTargetPath(notice) },
  }));
  const rest = entries.slice(shown.length);
  if (rest.length > 0) {
    // The summary is as pressing as the most pressing notice it stands for.
    toasts.push({
      id: `summary:${rest[0].id}`,
      priority: rest[0].priority,
      message: t('arrivals.more', { count: rest.length }),
      code: null,
      action: { label: t('arrivals.viewAll'), path: NOTIFICATIONS_PATH },
    });
  }
  return toasts;
}

// Fills the free places with the toasts that wait, in order; `now` is when they show.
function promote(state, visible, waiting, now) {
  const nextVisible = [...visible];
  const nextWaiting = [...waiting];
  while (nextVisible.length < OCC_TOAST_LIMIT && nextWaiting.length > 0) nextVisible.push(show(nextWaiting.shift(), now));
  const same = nextVisible.length === state.visible.length && nextWaiting.length === state.waiting.length
    && nextVisible.every((toast, index) => toast === state.visible[index]);
  return same ? state : queue(nextVisible, nextWaiting);
}

/**
 * The queue's reducer. State `{ visible, waiting }`; a visible toast also carries `shownAt` and `expiresAt` (ms).
 * - `{ type: 'arrive', toasts, now }`: one burst, as arrivalToasts builds it. A toast already queued is ignored.
 * - `{ type: 'dismiss', id, now }`: the controller closed it, ran its action, or received its alert.
 * - `{ type: 'expire', now }`: removes the toasts whose time is over.
 * - `{ type: 'clear' }`: empties the queue, waiting toasts included (the controller opened «Alertas y avisos», which
 *   shows every notice they stand for).
 * After a dismiss or an expiry the waiting toasts take the free places. An unknown action leaves the state as it is.
 */
export function reduceToastQueue(state = EMPTY_TOAST_QUEUE, action = {}) {
  switch (action.type) {
    case 'arrive': {
      const now = requireNow(action);
      const known = new Set([...state.visible, ...state.waiting].map(toast => toast.id));
      const burst = new Set();
      let visible = [...state.visible];
      const waiting = [...state.waiting];
      for (const toast of action.toasts ?? []) {
        if (!toast || known.has(toast.id)) continue;
        known.add(toast.id);
        burst.add(toast.id);
        if (visible.length >= OCC_TOAST_LIMIT) {
          const giving = visible.find(item => item.priority !== 'urgent' && !burst.has(item.id));
          if (giving) visible = visible.filter(item => item !== giving);
        }
        if (visible.length < OCC_TOAST_LIMIT) visible.push(show(toast, now));
        else waiting.push(Object.freeze({ ...toast }));
      }
      return burst.size === 0 ? state : queue(visible, waiting);
    }
    case 'dismiss': {
      const now = requireNow(action);
      const keep = toast => toast.id !== action.id;
      return promote(state, state.visible.filter(keep), state.waiting.filter(keep), now);
    }
    case 'expire': {
      const now = requireNow(action);
      return promote(state, state.visible.filter(toast => toast.expiresAt > now), state.waiting, now);
    }
    case 'clear':
      return state.visible.length === 0 && state.waiting.length === 0 ? state : EMPTY_TOAST_QUEUE;
    default:
      return state;
  }
}

/** When the next visible toast's time is over (ms), or `null` with nothing on screen. */
export function nextToastExpiry(state) {
  const visible = state?.visible ?? [];
  return visible.length === 0 ? null : Math.min(...visible.map(toast => toast.expiresAt));
}
