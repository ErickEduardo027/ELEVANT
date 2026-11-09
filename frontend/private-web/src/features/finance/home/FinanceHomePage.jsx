import EmptyState from '../../../components/EmptyState';
import { AlertIcon, ArrowIcon, HomeIcon, PreInvoiceIcon, ReconciliationIcon, ReportIcon, TariffIcon } from '../components/icons';
import { FINANCE_MODULE_IDS } from '../shell/modules';

function formatDay(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatMoney(amount, currency) {
  return new Intl.NumberFormat('es-DO', { style: 'currency', currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

const plural = (count, one, many) => `${count.toLocaleString('es-DO')} ${count === 1 ? one : many}`;

/** One indicator of «Inicio»: its figure, what it counts and, when the account may open it, its module. */
function HomeCard({ label, icon: Icon, tone = 'default', children, detail, action }) {
  return <article aria-label={label}
    className={`flex flex-col rounded-2xl border bg-white/70 p-4 shadow-sm backdrop-blur-md dark:bg-surface-dark-card ${
      tone === 'danger' ? 'border-status-danger/30 dark:border-status-danger/30' : 'border-black/5 dark:border-white/5'}`}>
    <header className="flex items-center justify-between gap-2">
      <h2 className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">{label}</h2>
      {Icon && <Icon className="h-4 w-4 text-accent-600" />}
    </header>
    <div className={`mt-3 space-y-1 font-semibold tabular-nums ${tone === 'danger' ? 'text-status-danger' : 'text-ink-900 dark:text-text-primary-dark'}`}>
      {children}
    </div>
    {detail && <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">{detail}</p>}
    {action && <button type="button" onClick={action.onClick}
      className="mt-auto flex items-center gap-1 pt-3 text-xs font-semibold text-accent-600 hover:underline">
      {action.label}<ArrowIcon className="h-3.5 w-3.5" />
    </button>}
  </article>;
}

/** A figure per currency (USD and DOP never add up), or what an empty month means. */
function PerCurrency({ items, amount, count, empty }) {
  if (!items.length) return <p className="text-sm font-medium text-text-secondary-light dark:text-text-secondary-dark">{empty}</p>;
  return items.map(item => <p key={item.currencyCode}>
    <span className="block text-2xl">{formatMoney(amount(item), item.currencyCode)}</span>
    {count && <span className="block text-xs font-normal text-text-secondary-light dark:text-text-secondary-dark">{count(item)}</span>}
  </p>);
}

function Notice({ title, hint, onRetry }) {
  return <div role="alert" className="rounded-2xl border border-status-danger/30 bg-white/70 p-6 dark:bg-surface-dark-card">
    <p className="font-semibold text-status-danger">{title}</p>
    {hint && <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{hint}</p>}
    {onRetry && <button type="button" onClick={onRetry}
      className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button>}
  </div>;
}

/**
 * «Inicio» of Finance (phase 4, block B, 4-A and 4-N02): the indicators the server computes for the station at the
 * business day of Santo Domingo. A card shows only when the template includes its module; nothing about preinvoices.
 */
export default function FinanceHomePage({ status, data, error = '', refreshing = false, onRetry, onNavigate,
  canOpen = () => true, stations = [], stationId = '', onStationChange }) {
  const open = (moduleId, label) => (canOpen(moduleId) ? { label, onClick: () => onNavigate(moduleId) } : null);
  const visible = (status === 'success' || status === 'empty') && data;

  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-500">Departamento de Finanzas</p>
        <h1 className="mt-1 text-2xl font-bold text-ink-900 dark:text-text-primary-dark">Resumen financiero</h1>
        <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          {visible ? `Indicadores de la estación al ${formatDay(data.businessDate)} (día hábil de República Dominicana).`
            : 'Indicadores de facturación, cobros y pendientes de la estación autorizada.'}
        </p>
      </div>
      <div className="flex items-end gap-3">
        {refreshing && <p role="status" className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Actualizando…</p>}
        {stations.length > 0 && <label className="text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark">
          Estación financiera
          <select aria-label="Estación financiera" value={stationId}
            onChange={event => onStationChange(event.target.value)}
            className="mt-1 block rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-ink-900 dark:bg-surface-dark-card dark:text-text-primary-dark">
            {stations.map(station => <option key={station.stationId} value={station.stationId}>{station.stationCode}</option>)}
          </select>
        </label>}
      </div>
    </header>

    {status === 'no-station' && <Notice title="No hay una estación financiera autorizada para esta consulta."
      hint="Pida a Superadministración que le asigne una estación de Finanzas." />}
    {status === 'forbidden' && <Notice title="No tiene permiso para ver el resumen de Finanzas en esta estación."
      hint="Compruebe sus permisos vigentes con el administrador del departamento." />}
    {status === 'error' && <Notice title="No se pudo cargar el resumen financiero." hint={error} onRetry={onRetry} />}
    {visible && error && <p role="alert" className="rounded-xl border border-status-danger/30 px-4 py-3 text-sm text-status-danger">
      No se pudo actualizar el resumen: {error} <button type="button" onClick={onRetry} className="font-semibold underline">Reintentar</button>
    </p>}

    {status === 'loading' && <div role="status" aria-label="Cargando resumen financiero"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map(item => <div key={item} data-testid="kpi-skeleton"
        className="h-32 animate-pulse rounded-2xl border border-black/5 bg-white/60 dark:bg-surface-dark-card" />)}
    </div>}

    {status === 'empty' && <EmptyState icon={HomeIcon} title="Sin indicadores"
      description="Su plantilla no incluye indicadores de Finanzas. Pida al administrador del departamento los módulos que necesita." />}

    {status === 'success' && data && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {data.toInvoice && <HomeCard label="Operaciones por facturar" icon={PreInvoiceIcon}
        detail={data.toInvoice.operations > 0
          ? `${plural(data.toInvoice.airlines, 'aerolínea', 'aerolíneas')} · la más antigua del ${formatDay(data.toInvoice.oldestOperationDate)}`
          : 'No hay operaciones aprobadas pendientes de factura.'}
        action={open(FINANCE_MODULE_IDS.TO_INVOICE, 'Ver por facturar')}>
        <p className="text-3xl">{data.toInvoice.operations.toLocaleString('es-DO')}</p>
      </HomeCard>}
      {data.invoicedThisMonth && <HomeCard label="Facturado este mes" icon={ReportIcon}
        action={open(FINANCE_MODULE_IDS.RECONCILIATION, 'Ver facturas')}>
        <PerCurrency items={data.invoicedThisMonth} amount={item => item.amount}
          count={item => plural(item.count, 'factura', 'facturas')} empty="Sin facturas este mes." />
      </HomeCard>}
      {data.receivables && <HomeCard label="Por cobrar" icon={ReconciliationIcon}
        action={open(FINANCE_MODULE_IDS.RECONCILIATION, 'Ver facturas')}>
        <PerCurrency items={data.receivables} amount={item => item.open}
          count={item => plural(item.openInvoices, 'factura abierta', 'facturas abiertas')} empty="No hay saldos pendientes." />
      </HomeCard>}
      {data.receivables && <HomeCard label="Vencido" icon={AlertIcon}
        tone={data.receivables.some(item => item.overdue > 0) ? 'danger' : 'default'}
        action={open(FINANCE_MODULE_IDS.RECONCILIATION, 'Ver facturas vencidas')}>
        <PerCurrency items={data.receivables.filter(item => item.overdueInvoices > 0)} amount={item => item.overdue}
          count={item => plural(item.overdueInvoices, 'factura vencida', 'facturas vencidas')} empty="Nada vencido." />
      </HomeCard>}
      {data.cardCollectionsThisMonth && <HomeCard label="Cobrado con tarjeta este mes" icon={ReconciliationIcon}
        action={open(FINANCE_MODULE_IDS.RECONCILIATION, 'Ver facturas')}>
        <PerCurrency items={data.cardCollectionsThisMonth} amount={item => item.amount}
          count={item => plural(item.count, 'pago', 'pagos')} empty="Sin pagos con tarjeta este mes." />
      </HomeCard>}
      {data.pendingContractApprovals !== null && <HomeCard label="Contratos por aprobar" icon={TariffIcon}
        action={open(FINANCE_MODULE_IDS.CONTRACT_APPROVALS, 'Ver aprobaciones')}>
        <p className="text-3xl">{data.pendingContractApprovals.toLocaleString('es-DO')}</p>
      </HomeCard>}
      {data.chartersAwaitingPrepayment !== null && <HomeCard label="Charters con prepago pendiente" icon={PreInvoiceIcon}
        action={open(FINANCE_MODULE_IDS.CHARTERS, 'Ver charters')}>
        <p className="text-3xl">{data.chartersAwaitingPrepayment.toLocaleString('es-DO')}</p>
      </HomeCard>}
    </div>}
  </div>;
}
