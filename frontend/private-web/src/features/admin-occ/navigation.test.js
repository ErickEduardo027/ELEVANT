import { describe, expect, it } from 'vitest';
import { ADMIN_OCC_NAVIGATION, OCC_NAV_SECTIONS } from './navigation';
import { occShellMessages } from './shell/occShellMessages';

// Each group with the names of its modules, as the rail shows them in a language.
const railGroups = language => OCC_NAV_SECTIONS.map(section => [
  occShellMessages[language].sections[section.id],
  section.items.map(id => occShellMessages[language].nav[id]),
]);

describe('OCC navigation', () => {
  it('groups the 14 OCC modules in En vivo, Planificar, Revisar and Estación, each once and in order', () => {
    expect(OCC_NAV_SECTIONS.map(section => section.id)).toEqual(['live', 'plan', 'review', 'station']);
    expect(railGroups('es')).toEqual([
      ['En vivo', ['Panorama', 'Monitoreo de vuelos', 'Mapa de posiciones', 'Chat interno']],
      ['Planificar', ['Planificación', 'Cobertura de posiciones', 'Contratos listos']],
      ['Revisar', ['Revisión', 'Reportes', 'Notificaciones']],
      ['Estación', ['Datos maestros', 'Tablets', 'Usuarios', 'Mis gastos']],
    ]);
    expect(railGroups('en')).toEqual([
      ['Live', ['Overview', 'Flight monitoring', 'Positions map', 'Internal chat']],
      ['Plan', ['Planning', 'Stand coverage', 'Ready contracts']],
      ['Review', ['Review', 'Reports', 'Notifications']],
      ['Station', ['Master data', 'Tablets', 'Users', 'My expenses']],
    ]);

    // Every module of the OCC is in exactly one group, and a group names only OCC modules.
    const grouped = OCC_NAV_SECTIONS.flatMap(section => section.items);
    expect(grouped).toHaveLength(14);
    expect(new Set(grouped).size).toBe(14);
    expect([...grouped].sort()).toEqual(ADMIN_OCC_NAVIGATION.map(item => item.id).sort());
    // The grouping is a constant: nothing can reorder the rail at run time.
    expect(Object.isFrozen(OCC_NAV_SECTIONS)).toBe(true);
    expect(OCC_NAV_SECTIONS.every(section => Object.isFrozen(section) && Object.isFrozen(section.items))).toBe(true);
  });

  it('keeps the id, route, access rule and label of every module', () => {
    // The regrouping only moves modules in the rail: routes and permissions are what links, guards and the cycle E2E
    // rely on.
    const access = item => item.permission ?? (item.administratorsOnly ? 'department administrators' : 'every account');
    expect(ADMIN_OCC_NAVIGATION.map(item => [item.id, item.path, access(item), item.label])).toEqual([
      ['expenses', '/admin-occ/expenses', 'every account', 'Mis gastos'],
      ['dashboard', '/admin-occ/dashboard', 'operations.dashboard.read', 'Dashboard'],
      ['planning', '/admin-occ/planning', 'operations.planning.read', 'Planificación operativa'],
      ['coverage', '/admin-occ/position-coverage', 'operations.coverage.read', 'Cobertura de posiciones'],
      ['master-data', '/admin-occ/master-data', 'operations.master_data.read', 'Datos maestros'],
      ['devices', '/admin-occ/devices', 'operations.devices.read', 'Tablets'],
      ['contracts', '/admin-occ/contracts', 'operations.planning.read', 'Contratos listos'],
      ['flight-monitoring', '/admin-occ/flight-monitoring', 'operations.flight_monitoring.read', 'Monitoreo de vuelos'],
      ['positions-map', '/admin-occ/positions-map', 'operations.positions_map.read', 'Mapa de posiciones'],
      ['approvals', '/admin-occ/review', 'operations.review.read', 'Revisión'],
      ['reports', '/admin-occ/reports', 'operations.reports.read', 'Reportes'],
      ['notifications', '/admin-occ/notifications', 'operations.notifications.read', 'Notificaciones'],
      ['chat', '/admin-occ/chat', 'operations.chat.read', 'Chat interno'],
      ['users', '/admin-occ/users', 'department administrators', 'Usuarios del departamento'],
    ]);
  });
});
