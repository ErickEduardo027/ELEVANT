import { describe, expect, it } from 'vitest';
import {
  chargeSourceLabel, checklistAnswerLabel, checklistStatusLabel, equipmentStatusLabel, incidentSeverityLabel,
  incidentStatusLabel, incidentTypeLabel, milestoneLabel, operationStatusLabel, serviceOrderStateLabel,
  serviceStatusLabel, submissionStatusLabel, unitLabel,
} from './operationLabels';

describe('operationLabels (3-N22)', () => {
  it('names every operation state in Spanish, the cancelled ones included', () => {
    expect(['Planned', 'Assigned', 'InProgress', 'PendingReview', 'InReview', 'Approved', 'Returned', 'Cancelled']
      .map(code => operationStatusLabel(code))).toEqual(['Planificada', 'Asignada', 'En curso',
      'Pendiente de revisión', 'En revisión', 'Aprobada', 'Devuelta', 'Cancelada']);
  });

  it('names the hand-off, service, checklist and answer codes OCC reviews', () => {
    expect(['PendingReview', 'InReview', 'Approved', 'Returned'].map(code => submissionStatusLabel(code)))
      .toEqual(['Pendiente', 'En revisión', 'Aprobada', 'Devuelta']);
    expect(['Planned', 'InProgress', 'Completed', 'NotPerformed', 'Exception'].map(code => serviceStatusLabel(code)))
      .toEqual(['Planificado', 'En curso', 'Completado', 'No realizado', 'Con excepción']);
    expect(['NotStarted', 'InProgress', 'Submitted'].map(code => checklistStatusLabel(code)))
      .toEqual(['Sin iniciar', 'En curso', 'Enviado']);
    expect(['Ok', 'NotOk', 'NotApplicable'].map(code => checklistAnswerLabel(code)))
      .toEqual(['Conforme', 'No conforme', 'No aplica']);
  });

  it('uses the tablet texts for the incidents', () => {
    expect(['Operational', 'Safety', 'Equipment', 'Documentation', 'Deviation'].map(code => incidentTypeLabel(code)))
      .toEqual(['Operativa', 'Seguridad', 'Equipo', 'Documentación', 'Desviación']);
    expect(['Low', 'Medium', 'High', 'Critical'].map(code => incidentSeverityLabel(code)))
      .toEqual(['Baja', 'Media', 'Alta', 'Crítica']);
    expect(['Open', 'InReview', 'Resolved', 'Closed'].map(code => incidentStatusLabel(code)))
      .toEqual(['Abierta', 'En revisión', 'Resuelta', 'Cerrada']);
  });

  it('names who marked a charge, the equipment, the Service Order and the milestones', () => {
    expect(['Agent', 'Automatic', 'Occ'].map(code => chargeSourceLabel(code))).toEqual(['Agente', 'Automático', 'OCC']);
    expect(equipmentStatusLabel('Available')).toBe('Disponible');
    expect(['Signed', 'Corrected', 'Stale', 'Unsigned'].map(code => serviceOrderStateLabel(code)))
      .toEqual(['Firmada', 'Corregida por OCC', 'Firma desactualizada', 'Sin firmar']);
    expect(milestoneLabel('BLOCK_ON')).toBe('Bloqueo');
    expect(milestoneLabel('PUSHBACK')).toBe('Push-back');
  });

  it('shows a billing unit with Finance\'s noun', () => {
    expect(unitLabel('operation')).toBe('operación');
    expect(unitLabel('hour')).toBe('hora');
    expect(unitLabel('gpu-block', [{ code: 'gpu-block', name: 'Bloque GPU' }])).toBe('bloque gpu');
  });

  it('never shows a raw code: an unknown one is «Otro (código)» and a missing one is empty', () => {
    expect(operationStatusLabel('Teleported')).toBe('Otro (Teleported)');
    expect(incidentTypeLabel('Weather')).toBe('Otro (Weather)');
    expect(milestoneLabel('FUEL')).toBe('Otro (FUEL)');
    expect(serviceStatusLabel(null)).toBe('');
    expect(checklistAnswerLabel(' ')).toBe('');
  });

  it('spells the codes out inside the English scope', () => {
    expect(operationStatusLabel('PendingReview', 'en')).toBe('Pending review');
    expect(checklistAnswerLabel('NotOk', 'en')).toBe('Not ok');
    expect(incidentTypeLabel('Weather', 'en')).toBe('Other (Weather)');
  });
});
