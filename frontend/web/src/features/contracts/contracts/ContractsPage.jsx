import { useState } from 'react';
import { ContractIcon, ServiceIcon } from '../components/icons';
import ContractFormModal from './ContractFormModal';
import { useContractsData } from './useContractsData';

const STATUS_META = {
  active: { label: 'Activo', classes: 'bg-status-success/10 text-status-success' },
  expiring: { label: 'Próximo a vencer', classes: 'bg-status-warning/15 text-amber-700 dark:text-status-warning' },
  expired: { label: 'Vencido', classes: 'bg-status-danger/10 text-status-danger' },
  disabled: { label: 'Inhabilitado', classes: 'bg-black/5 text-text-secondary-light dark:bg-white/10 dark:text-text-secondary-dark' },
};

function formatDate(value) {
  if (!value) return 'Sin vencimiento';
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
}

export default function ContractsPage() {
  const contractsData = useContractsData();
  const [formOpen, setFormOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);

  function openCreate() {
    setSelectedContract(null);
    setFormOpen(true);
  }

  function openEdit(contract) {
    setSelectedContract(contract);
    setFormOpen(true);
  }

  async function handleSubmit(values) {
    if (selectedContract) return contractsData.editContract(selectedContract.id, values);
    return contractsData.addContract(values);
  }

  if (contractsData.status === 'error') {
    return (
      <div role="alert" className="rounded-2xl border border-status-danger/30 bg-white/70 p-6 dark:bg-surface-dark-card">
        <p className="font-semibold text-status-danger">No se pudieron cargar los contratos.</p>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{contractsData.error?.message}</p>
        <button type="button" onClick={contractsData.retry} className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Gestión contractual</p>
          <h1 className="mt-1 text-2xl font-bold text-ink-900 dark:text-text-primary-dark">Contratos</h1>
          <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Registra y consulta contratos, vigencias y condiciones por aerolínea.</p>
        </div>
        <button type="button" onClick={openCreate} className="rounded-xl bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-600/90">+ Registrar contrato</button>
      </header>

      <section className="rounded-2xl border border-black/5 bg-white/70 p-4 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
        <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_220px_auto]">
          <label>
            <span className="sr-only">Buscar contrato</span>
            <input type="search" value={contractsData.query} onChange={event => contractsData.setQuery(event.target.value)} placeholder="Buscar por contrato, aerolínea o código…" className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:border-accent-600 dark:border-white/10 dark:bg-surface-dark" />
          </label>
          <label>
            <span className="sr-only">Filtrar por estado</span>
            <select value={contractsData.statusFilter} onChange={event => contractsData.setStatusFilter(event.target.value)} className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm outline-none focus:border-accent-600 dark:border-white/10 dark:bg-surface-dark">
              <option value="all">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="expiring">Próximos a vencer</option>
              <option value="expired">Vencidos</option>
              <option value="disabled">Inhabilitados</option>
            </select>
          </label>
          <div className="flex items-center justify-end text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{contractsData.contracts.length} contratos</div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 shadow-sm backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
        {contractsData.status === 'loading' ? (
          <div data-testid="contracts-list-skeleton" className="h-80 animate-pulse bg-black/[0.03] dark:bg-white/[0.03]" />
        ) : contractsData.contracts.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-black/[0.025] text-xs uppercase tracking-wide text-text-secondary-light dark:bg-white/[0.025] dark:text-text-secondary-dark">
                <tr><th className="px-5 py-3">Contrato</th><th className="px-5 py-3">Aerolínea</th><th className="px-5 py-3">Vigencia</th><th className="px-5 py-3">Servicios</th><th className="px-5 py-3">Estado</th><th className="px-5 py-3 text-right">Acciones</th></tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-white/5">
                {contractsData.contracts.map(contract => {
                  const meta = STATUS_META[contract.status];
                  return (
                    <tr key={contract.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                      <td className="px-5 py-4"><span className="flex items-center gap-2 font-mono text-xs font-semibold"><ContractIcon className="h-4 w-4 text-accent-600" />{contract.id}</span></td>
                      <td className="px-5 py-4"><span className="block font-semibold">{contract.airline}</span><span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{contract.airlineCode}</span></td>
                      <td className="px-5 py-4 text-text-secondary-light dark:text-text-secondary-dark"><span className="block text-xs font-semibold uppercase">{contract.contractType === 'permanent' ? 'Permanente' : 'Temporal'}</span>{formatDate(contract.startDate)} — {formatDate(contract.endDate)}</td>
                      <td className="px-5 py-4"><span className="inline-flex items-center gap-1.5"><ServiceIcon className="h-4 w-4 text-accent-600" />{contract.servicesCount}</span></td>
                      <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.classes}`}>{meta.label}</span></td>
                      <td className="px-5 py-4 text-right"><button type="button" onClick={() => openEdit(contract)} className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-accent-600 hover:bg-accent-600/5 dark:border-white/10">Ver / actualizar</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <ContractIcon className="h-10 w-10 text-text-secondary-light/50" />
            <h2 className="mt-3 font-semibold">No se encontraron contratos</h2>
            <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">Cambia los filtros o registra un nuevo contrato.</p>
          </div>
        )}
      </section>

      <ContractFormModal open={formOpen} contract={selectedContract} onClose={() => setFormOpen(false)} onSubmit={handleSubmit} />
    </div>
  );
}
