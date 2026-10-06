import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotificationSeverityBadge from './NotificationSeverityBadge';

describe('NotificationSeverityBadge', () => {
  it('renders the Spanish label for a critical severity', () => {
    render(<NotificationSeverityBadge severity="critical" />);
    expect(screen.getByText('Crítica')).toBeInTheDocument();
  });

  it('renders the label for a positive/success severity', () => {
    render(<NotificationSeverityBadge severity="success" />);
    expect(screen.getByText('Positiva')).toBeInTheDocument();
  });
});