import { afterEach, describe, expect, it } from 'vitest';
import { reconcileRecord, resetReconciliationsForTests } from './reconciliationService';
afterEach(resetReconciliationsForTests);
describe('reconciliationService', () => { it('records the resolution of a difference', async () => { const row = await reconcileRecord('CON-2026-026','Ajuste aprobado'); expect(row.status).toBe('reconciled'); expect(row.note).toBe('Ajuste aprobado'); }); });
