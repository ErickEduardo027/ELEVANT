import { describe, expect, it } from 'vitest';
import { PUJ_COORDINATES } from './flightMonitoringMappers';

describe('PUJ_COORDINATES', () => {
  it('is the fixed coordinate pair for Punta Cana International Airport', () => {
    expect(PUJ_COORDINATES).toEqual({ latitude: 18.5674, longitude: -68.3634 });
  });
});
