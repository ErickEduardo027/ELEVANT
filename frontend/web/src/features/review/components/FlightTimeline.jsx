import ReviewSection from './ReviewSection';
import { TIMELINE_STEPS, formatClockTime } from '../reviewMappers';

export default function FlightTimeline({ timeline = {} }) {
  return (
    <ReviewSection title="Timeline operacional">
      <div data-testid="review-flight-timeline" className="flex gap-0 overflow-x-auto pb-1">
        {TIMELINE_STEPS.map((step, index) => {
          const time = timeline[step.key];
          const isMissing = !time;
          return (
            <div key={step.key} className="flex min-w-[104px] flex-col items-center gap-1 text-center">
              <div className="flex w-full items-center">
                <span className={`h-px flex-1 ${index === 0 ? 'invisible' : 'bg-black/10 dark:bg-white/10'}`} />
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    isMissing
                      ? 'border border-dashed border-text-secondary-light/60 dark:border-text-secondary-dark/60'
                      : 'bg-accent-600'
                  }`}
                />
                <span
                  className={`h-px flex-1 ${index === TIMELINE_STEPS.length - 1 ? 'invisible' : 'bg-black/10 dark:bg-white/10'}`}
                />
              </div>
              <span
                className={`font-mono text-xs ${
                  isMissing ? 'text-text-secondary-light/70 dark:text-text-secondary-dark/70' : 'text-ink-900 dark:text-text-primary-dark'
                }`}
              >
                {isMissing ? 'Sin registro' : formatClockTime(time)}
              </span>
              <span className="text-[11px] leading-tight text-text-secondary-light dark:text-text-secondary-dark">{step.label}</span>
            </div>
          );
        })}
      </div>
    </ReviewSection>
  );
}
