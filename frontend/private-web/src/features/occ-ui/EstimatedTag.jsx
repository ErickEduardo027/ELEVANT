'use client';

import { useLanguage } from '../../i18n/LanguageScope';
import { TAGS } from './statusVocabulary';

/**
 * The «est.» provenance tag of the OCC (contratos 2.4): something calculated from the schedule and not measured, such
 * as the position of an aircraft without a live signal. The word on a dashed outline, the texture TAGS.estimated
 * names, never a hue. The word is the tag's own text, so `getByText('est.')` finds the tag itself; the sibling of
 * DemoTag.
 */
export default function EstimatedTag({ className = '' }) {
  const { language } = useLanguage();
  return (
    <span data-occ-tag="estimated"
      className={`inline-flex items-center rounded-[2px] border border-dashed border-occ-muted px-1.5 text-xs font-semibold leading-5 text-occ-text ${className}`}>
      {TAGS.estimated[language]}
    </span>
  );
}
