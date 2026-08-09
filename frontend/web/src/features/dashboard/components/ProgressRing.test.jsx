import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProgressRing from './ProgressRing';

describe('ProgressRing', () => {
  it('renders the executed-vs-total percentage rounded to the nearest whole number', () => {
    render(<ProgressRing pending={18} executed={96} />);
    // 96 / (18 + 96) = 84.2% -> rounds to 84%
    expect(screen.getByText('84%')).toBeInTheDocument();
  });

  it('renders 0% when there is no activity yet', () => {
    render(<ProgressRing pending={0} executed={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});
