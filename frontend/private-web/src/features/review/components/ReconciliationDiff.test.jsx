import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReconciliationDiff from './ReconciliationDiff';

describe('ReconciliationDiff', () => {
  it('shows the empty copy when there is nothing to reconcile', () => {
    render(<ReconciliationDiff operation={{ reconciliation: [] }} />);
    expect(screen.getByText('Sin conceptos facturables por conciliar.')).toBeInTheDocument();
  });

  it('flags a two-unit surplus as a critical discrepancy', () => {
    render(<ReconciliationDiff operation={{ reconciliation: [{ concept: 'GPU', unit: 'unidad', contracted: 1, executed: 3 }] }} />);
    expect(screen.getByText('GPU')).toBeInTheDocument();
    expect(screen.getByText('Discrepancia crítica')).toBeInTheDocument();
  });

  it('marks a matching concept as "Coincide"', () => {
    render(<ReconciliationDiff operation={{ reconciliation: [{ concept: 'Baggage Handling', unit: 'agentes', contracted: 4, executed: 4 }] }} />);
    expect(screen.getByText('Coincide')).toBeInTheDocument();
  });
});