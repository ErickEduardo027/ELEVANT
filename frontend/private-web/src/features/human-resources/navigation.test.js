import { describe, expect, it } from 'vitest';
import {
  HUMAN_RESOURCES_MODULE_IDS, HUMAN_RESOURCES_NAV_SECTIONS, HUMAN_RESOURCES_NAVIGATION, humanResourcesNavigation,
} from './navigation';

// Each entry of the menu with the names of its modules, as the sidebar shows them.
const menu = navigation => navigation.map(item => (item.children ? [item.label, item.children.map(child => child.label)] : item.label));

describe('Gestión Humana navigation (ADR-0047)', () => {
  it('groups the modules in Personal, Operación de rampa, Seguimiento and Accesos, with Configuración apart', () => {
    expect(menu(humanResourcesNavigation(HUMAN_RESOURCES_NAVIGATION))).toEqual([
      ['Personal', ['Dashboard', 'Empleados']],
      ['Operación de rampa', ['Agentes de rampa', 'Habilitaciones y certificaciones', 'Carnets y permisos aeroportuarios',
        'Horarios y disponibilidad', 'Revisión de asistencia']],
      ['Seguimiento', ['Reportes', 'Trazabilidad / Auditoría']],
      ['Accesos', ['Validaciones de acceso', 'Usuarios del departamento']],
      'Configuración',
    ]);
  });

  it('places every module in exactly one section', () => {
    const grouped = HUMAN_RESOURCES_NAV_SECTIONS.flatMap(section => section.items);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(HUMAN_RESOURCES_NAVIGATION.map(item => item.id).sort());
  });

  it('keeps the route of every module and none of the retired ones', () => {
    expect(HUMAN_RESOURCES_NAVIGATION.every(item => item.path === `/gestion-humana/${item.id}`)).toBe(true);
    for (const retired of ['expenses', 'positions', 'requisitions', 'notifications']) {
      expect(Object.values(HUMAN_RESOURCES_MODULE_IDS), retired).not.toContain(retired);
    }
    const permissions = HUMAN_RESOURCES_NAVIGATION.map(item => item.permission);
    expect(permissions).not.toContain('human_resources.requisitions.read');
    expect(permissions).not.toContain('human_resources.positions.read');
    expect(permissions).not.toContain('human_resources.notifications.read');
  });

  it('keeps only the allowed modules and drops a section left empty', () => {
    const allowed = HUMAN_RESOURCES_NAVIGATION.filter(item =>
      [HUMAN_RESOURCES_MODULE_IDS.REPORTS, HUMAN_RESOURCES_MODULE_IDS.ACCESS_REQUESTS].includes(item.id));
    const navigation = humanResourcesNavigation(allowed);
    expect(menu(navigation)).toEqual([['Seguimiento', ['Reportes']], ['Accesos', ['Validaciones de acceso']]]);
    expect(navigation[0].children[0].path).toBe('/gestion-humana/reports');
    expect(humanResourcesNavigation([])).toEqual([]);
  });
});
