import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotificationFeed from './NotificationFeed';

const NOW_ISO = '2026-08-08T14:00:00-04:00';

function makeNotification(overrides) {
  return {
    id: 'NOT-1',
    category: 'operational',
    severity: 'info',
    title: 'Título',
    description: 'Descripción',
    read: false,
    createdAt: NOW_ISO,
    flightNumber: null,
    airline: null,
    position: null,
    operationId: null,
    relatedModule: null,
    relatedRoute: null,
    source: 'Sistema',
    metadata: {},
    ...overrides,
  };
}

describe('NotificationFeed', () => {
  it('renders date-group separators in order and skips empty groups', () => {
    const notifications = [
      makeNotification({ id: 'today-1', title: 'Hoy 1', createdAt: '2026-08-08T09:00:00-04:00' }),
      makeNotification({ id: 'older-1', title: 'Antigua 1', createdAt: '2026-07-01T09:00:00-04:00' }),
    ];

    render(
      <NotificationFeed
        notifications={notifications}
        nowIso={NOW_ISO}
        selectedIds={new Set()}
        onToggleSelect={() => {}}
        onOpen={() => {}}
      />
    );

    const labels = screen.getAllByText(/^(HOY|AYER|ESTA SEMANA|ANTERIORES)$/).map(el => el.textContent);
    expect(labels).toEqual(['HOY', 'ANTERIORES']);
    expect(screen.getByText('Hoy 1')).toBeInTheDocument();
    expect(screen.getByText('Antigua 1')).toBeInTheDocument();
  });
});
