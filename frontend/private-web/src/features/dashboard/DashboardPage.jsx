import { useMemo } from 'react';
import { useTranslation } from '../../i18n/LanguageScope';
import { buildDashboardModel } from './dashboardModel';
import { dashboardMessages } from './dashboardMessages';
import AttentionPanel from './console/AttentionPanel';
import ContextStrip from './console/ContextStrip';
import RampMapPanel from './console/RampMapPanel';
import RecentNotices from './console/RecentNotices';
import RegionalTrafficPanel from './console/RegionalTrafficPanel';
import SummaryStrip from './console/SummaryStrip';
import TurnaroundBoard from './console/TurnaroundBoard';
import WeatherPanel from './console/WeatherPanel';

const BLOCKING_STATES = ['forbidden', 'unavailable', 'unauthorized', 'error', 'timeout'];
const IDLE_WEATHER = { status: 'loading', data: null, refreshFailed: false, refresh: () => {} };
const IDLE_TRAFFIC = { status: 'loading', data: null, refresh: () => {} };

// The apron is the primary map. Weather and regional context remain distinct:
// neither planned turnarounds nor satellite pixels become live aircraft telemetry.
export default function DashboardPage({
  status, data, refreshing = false, refreshFailed = false, fetchedAt = null, theme = 'light',
  weather = IDLE_WEATHER, traffic = IDLE_TRAFFIC, notices = null, onRetry = () => {}, onRefresh = onRetry,
}) {
  const { t, language, locale } = useTranslation(dashboardMessages);
  const model = useMemo(() => (status === 'success' && data ? buildDashboardModel(data) : null), [status, data]);
  const timeZone = data?.station?.ianaTimeZone;

  return (
    <div className="occ-dashboard mx-auto max-w-[1760px] space-y-4 overflow-x-clip rounded-[1.5rem] p-1 sm:p-3">
      <ContextStrip t={t} locale={locale} data={model ? data : null} refreshing={refreshing}
        refreshFailed={refreshFailed} fetchedAt={fetchedAt} onRefresh={onRefresh} />

      {BLOCKING_STATES.includes(status) && (
        <div role="alert" className="rounded-xl border border-occ-line-strong bg-occ-panel p-5">
          <p className="text-sm font-semibold text-occ-danger">{t(`states.${status}`)}</p>
          {(status === 'error' || status === 'timeout') && <button type="button" onClick={onRetry}
            className="mt-3 h-9 rounded-md bg-accent-600 px-4 text-xs font-semibold text-white">{t('states.retry')}</button>}
        </div>
      )}

      {status === 'loading' && <p role="status"
        className="rounded-xl border border-occ-line bg-occ-panel p-5 text-sm text-occ-muted">{t('states.loading')}</p>}

      {model && <>
        <div className="occ-console-stage">
          <RampMapPanel t={t} theme={theme} turnarounds={data.turnarounds}
            className="occ-stage-primary" />
          <div className="occ-stage-aux">
            <WeatherPanel t={t} locale={locale} theme={theme} weather={weather} className="occ-stage-weather" />
            <RegionalTrafficPanel t={t} theme={theme} traffic={traffic} className="occ-stage-region" />
          </div>
          <div className="occ-stage-instruments">
            <SummaryStrip t={t} summary={model.summary} pendingReviewsIsLowerBound={model.pendingReviewsIsLowerBound} />
          </div>
        </div>
        <div className="occ-workbench grid grid-cols-1 gap-3 lg:grid-cols-12">
          <TurnaroundBoard t={t} language={language} locale={locale} timeZone={timeZone}
            groups={model.turnarounds} className="max-h-[480px] lg:col-span-7 xl:col-span-8" />
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-5 xl:col-span-4">
            <AttentionPanel t={t} locale={locale} timeZone={timeZone} pendingReviews={model.pendingReviews}
              isLowerBound={model.pendingReviewsIsLowerBound} needsResources={model.turnarounds.needsResources}
              className="max-h-[480px]" />
            <RecentNotices t={t} language={language} locale={locale} timeZone={timeZone}
              notices={notices?.items ?? model.notices} hasMore={notices ? notices.hasMore : data.notificationsHasMore} />
          </div>
        </div>
      </>}
    </div>
  );
}
