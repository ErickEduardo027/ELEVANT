import { describe, expect, it } from 'vitest';
import { ELEVANT_RULE_REASONS } from '@elevant/api-client';
import { planningMessages } from '../planning/planningMessages';
import { DEMO_STAND_REASON_TEXT, reasonsSentence, standReasonText } from './demoStandReasons';

/** The codes of OCC's assignment rule, as `DemoStandEligibility.ReasonOrder` lists them after `stand_not_covered`. */
const POLICY_CODES = ['agent_inactive', 'mobile_account_unavailable', 'station_scope_missing', 'terminal_scope_missing',
  'operational_position_unavailable', 'qualification_not_current', 'airport_id_not_current',
  'ramp_driver_license_not_current', 'shift_not_compatible', 'approved_absence', 'mentor_required', 'assignment_conflict'];
const OCC = planningMessages.es.assignment;

describe('demo stand reasons (ADR-0041)', () => {
  it('explains every policy code with the OCC texts', () => {
    for (const code of POLICY_CODES) {
      expect(OCC.reasons[code], code).toBeTruthy();
      expect(standReasonText(code), code).toBe(OCC.reasons[code]);
      expect(DEMO_STAND_REASON_TEXT[code], code).toBe(OCC.reasons[code]);
    }
    // The panel's own: nobody covers the stand when the aircraft parks, the map cannot draw it, it is not free.
    expect(standReasonText('stand_not_covered')).toBe('Nadie la cubre a esa hora');
    expect(standReasonText('stand_not_located')).toBe('Sin ubicar en el mapa');
    expect(standReasonText('stand_not_free')).toBe('No está libre para ese avión en ese horario');
    // Every reason the API gives for a stand that is not eligible reaches the panel (the client keeps known reasons
    // only) and has its words.
    for (const code of ['stand_not_covered', 'stand_not_located', ...POLICY_CODES]) {
      expect(ELEVANT_RULE_REASONS, code).toContain(code);
      expect(standReasonText(code), code).not.toBe(OCC.unknownReason);
    }
  });

  it('falls back for an unknown code', () => {
    expect(standReasonText('no_shift')).toBe(OCC.unknownReason);
    expect(standReasonText(undefined)).toBe(OCC.unknownReason);
    // An inherited name is no code of the table either.
    expect(standReasonText('toString')).toBe(OCC.unknownReason);
    // Two unknown codes say it once.
    expect(reasonsSentence(['no_shift', 'no_badge'])).toBe('no cumple una condición operativa');
  });

  it('joins the reasons in one phrase in lower case, each once', () => {
    expect(reasonsSentence(['stand_not_covered', 'shift_not_compatible'])).toBe('nadie la cubre a esa hora y turno no compatible');
    expect(reasonsSentence(['shift_not_compatible', 'mentor_required', 'shift_not_compatible', 'airport_id_not_current']))
      .toBe('turno no compatible, menos de 3 meses: necesita un mentor en su cobertura e identificación aeroportuaria no vigente');
    expect(reasonsSentence(['stand_not_located'])).toBe('sin ubicar en el mapa');
    expect(reasonsSentence([])).toBe('');
    expect(reasonsSentence(undefined)).toBe('');
  });
});
