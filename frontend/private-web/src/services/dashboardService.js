import { getPlanningSnapshot } from './planningService';
import { loadOccReviewQueue } from './occReviewService';
import { loadOperationalNotifications } from './operationalCommunicationService';

function stationToday(timeZone) {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric',
    month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export async function getDashboardSnapshot({ stationId, stationCode, date }, { signal } = {}) {
  if (!stationId || !stationCode || (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new TypeError('El panorama operativo requiere estación y fecha.');
  }

  const [review, notices] = await Promise.all([
    loadOccReviewQueue(stationId, { signal }),
    loadOperationalNotifications({ signal }),
  ]);
  if (review.stationId !== stationId || review.stationCode !== stationCode ||
      !review.ianaTimeZone) {
    throw new Error('El panorama operativo no coincide con la estación solicitada.');
  }
  const operationDate = date ?? stationToday(review.ianaTimeZone);
  const planning = await getPlanningSnapshot({ stationId, date: operationDate, signal });
  if (planning.station?.id !== stationId || planning.station?.code !== stationCode ||
      planning.date !== operationDate) {
    throw new Error('El panorama operativo no coincide con la estación solicitada.');
  }

  return {
    stationId, stationCode, date: operationDate,
    station: { name: planning.station.name ?? null, ianaTimeZone: planning.station.ianaTimeZone ?? review.ianaTimeZone },
    turnarounds: planning.turnarounds,
    reviews: review.operations,
    reviewHasMore: review.hasMore,
    notifications: notices.notifications
      .filter(notification => notification.stationCode === stationCode),
    notificationsHasMore: notices.hasMore,
  };
}
