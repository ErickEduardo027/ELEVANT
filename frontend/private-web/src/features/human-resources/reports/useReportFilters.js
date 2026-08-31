import { useMemo, useState } from 'react';
import {
  DATE_PRESETS,
  DOCUMENT_KIND_OPTIONS,
  EXPIRATION_STATUS_OPTIONS,
  REPORT_TABS,
  TERMINAL_OPTIONS,
  SHIFT_BLOCK_OPTIONS,
  resolveDateRange,
} from './reportsMappers';

const INITIAL_FILTERS = {
  documentKind: '',
  expirationStatus: '',
  terminal: '',
  movementKind: '',
  shiftBlock: '',
  coverageTerminal: '',
};

const MOVEMENT_KIND_OPTIONS = [
  { value: 'alta', label: 'Altas / activaciones' },
  { value: 'baja', label: 'Bajas / desactivaciones' },
];

function buildDateChip(datePreset) {
  if (datePreset === 'today') return null;
  const preset = DATE_PRESETS.find(item => item.id === datePreset);
  return preset?.label ?? 'Rango personalizado';
}

export function useHumanResourcesReportFilters() {
  const [activeReport, setActiveReport] = useState(REPORT_TABS[0].id);
  const [datePreset, setDatePreset] = useState('today');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [filters, setFilters] = useState(INITIAL_FILTERS);

  function setCustomDate(key, value) {
    setDatePreset('custom');
    setCustomRange(current => ({ ...current, [key]: value }));
  }

  function setFilter(key, value) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setDatePreset('today');
    setCustomRange({ from: '', to: '' });
    setFilters(INITIAL_FILTERS);
  }

  const dateRange = useMemo(() => resolveDateRange(datePreset, customRange.from, customRange.to), [datePreset, customRange]);

  const resolvedFilters = useMemo(() => {
    if (activeReport === 'expirations') {
      return {
        documentKind: filters.documentKind,
        status: filters.expirationStatus,
        terminal: filters.terminal,
      };
    }

    if (activeReport === 'accountMovements') {
      return {
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
        movementKind: filters.movementKind,
      };
    }

    if (activeReport === 'staffDistribution') {
      return {
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
        terminal: filters.terminal,
        shiftBlock: filters.shiftBlock,
      };
    }

    return {
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      terminal: filters.coverageTerminal,
      cutoffDate: dateRange.to,
    };
  }, [activeReport, dateRange, filters]);

  const hasActiveFilters = useMemo(
    () => {
      if (activeReport === 'expirations') {
        return filters.documentKind !== '' || filters.expirationStatus !== '' || filters.terminal !== '';
      }

      if (activeReport === 'accountMovements') {
        return datePreset !== 'today' || filters.movementKind !== '';
      }

      if (activeReport === 'staffDistribution') {
        return datePreset !== 'today' || filters.terminal !== '' || filters.shiftBlock !== '';
      }

      return datePreset !== 'today' || filters.coverageTerminal !== '';
    },
    [activeReport, datePreset, filters]
  );

  const activeChips = useMemo(() => {
    const chips = [];
    const dateChip = buildDateChip(datePreset);
    if (dateChip && activeReport !== 'expirations') chips.push(dateChip);

    if (activeReport === 'expirations') {
      if (filters.documentKind) {
        chips.push(DOCUMENT_KIND_OPTIONS.find(option => option.value === filters.documentKind)?.label ?? filters.documentKind);
      }
      if (filters.expirationStatus) {
        chips.push(EXPIRATION_STATUS_OPTIONS.find(option => option.value === filters.expirationStatus)?.label ?? filters.expirationStatus);
      }
      if (filters.terminal) {
        chips.push(TERMINAL_OPTIONS.find(option => option.value === filters.terminal)?.label ?? filters.terminal);
      }
    }

    if (activeReport === 'accountMovements' && filters.movementKind) {
      chips.push(MOVEMENT_KIND_OPTIONS.find(option => option.value === filters.movementKind)?.label ?? filters.movementKind);
    }

    if (activeReport === 'staffDistribution') {
      if (filters.terminal) chips.push(TERMINAL_OPTIONS.find(option => option.value === filters.terminal)?.label ?? filters.terminal);
      if (filters.shiftBlock) chips.push(SHIFT_BLOCK_OPTIONS.find(option => option.value === filters.shiftBlock)?.label ?? filters.shiftBlock);
    }

    if (activeReport === 'qualificationCoverage' && filters.coverageTerminal) {
      chips.push(TERMINAL_OPTIONS.find(option => option.value === filters.coverageTerminal)?.label ?? filters.coverageTerminal);
    }

    return chips;
  }, [activeReport, datePreset, filters]);

  return {
    activeReport,
    setActiveReport,
    datePreset,
    setDatePreset,
    customRange,
    setCustomDate,
    filters,
    setFilter,
    resetFilters,
    dateRange,
    resolvedFilters,
    hasActiveFilters,
    activeChips,
    movementKindOptions: MOVEMENT_KIND_OPTIONS,
    expirationControls: [
      { key: 'documentKind', label: 'Tipo de documento', value: filters.documentKind, onChange: value => setFilter('documentKind', value), options: DOCUMENT_KIND_OPTIONS },
      { key: 'expirationStatus', label: 'Estado', value: filters.expirationStatus, onChange: value => setFilter('expirationStatus', value), options: EXPIRATION_STATUS_OPTIONS },
      {
        key: 'terminal',
        label: 'Terminal',
        value: filters.terminal,
        onChange: value => setFilter('terminal', value),
        options: TERMINAL_OPTIONS,
      },
    ],
    movementControls: [
      { key: 'movementKind', label: 'Movimiento', value: filters.movementKind, onChange: value => setFilter('movementKind', value), options: MOVEMENT_KIND_OPTIONS },
    ],
    staffControls: [
      { key: 'terminal', label: 'Terminal', value: filters.terminal, onChange: value => setFilter('terminal', value), options: TERMINAL_OPTIONS },
      { key: 'shiftBlock', label: 'Turno', value: filters.shiftBlock, onChange: value => setFilter('shiftBlock', value), options: SHIFT_BLOCK_OPTIONS },
    ],
    coverageControls: [
      { key: 'coverageTerminal', label: 'Terminal', value: filters.coverageTerminal, onChange: value => setFilter('coverageTerminal', value), options: TERMINAL_OPTIONS },
    ],
  };
}
