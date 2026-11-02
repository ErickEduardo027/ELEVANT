'use client';
import { createContext, useContext } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';

const ExpenseLocaleContext = createContext(false);
const messages = { es: {}, en: {} };
// Translation is opt-in so existing Finance screens retain their default copy.
const spanish = { Department: 'Departamento', Finance: 'Finanzas', Submitted: 'Enviado', DepartmentApproved: 'Aprobado por departamento', Approved: 'Aprobado', Rejected: 'Rechazado' };
const english = {
  'Estación': 'Station', 'Buscar': 'Search', 'Estado': 'Status', 'Todos': 'All', 'Desde': 'From', 'Hasta': 'To',
  'Sin dimensión': 'No dimension', 'Seleccione…': 'Select…', 'Borrador': 'Draft', 'En revisión de departamento': 'Department review',
  'Pendiente de Finanzas': 'Awaiting Finance', 'Aprobado': 'Approved', 'Rechazado': 'Rejected', 'En revisión de Finanzas': 'Finance review',
  'Reintentar acción': 'Retry action', 'Hay cambios disponibles en estos documentos.': 'Updates are available for these documents.',
  'Actualizar documentos': 'Refresh documents', 'Reintentar carga': 'Retry loading', 'Cargando documentos…': 'Loading documents…',
  'No tiene estaciones asignadas.': 'No stations assigned.', 'Solicite el ámbito de estación a su administrador.': 'Ask your administrator for station access.',
  'Páginas de resultados': 'Result pages', 'Anterior': 'Previous', 'Página': 'Page', 'Siguiente': 'Next',
  'Moneda y tasa congelada a DOP': 'Currency and fixed DOP exchange rate', 'Moneda': 'Currency', 'Tasa a DOP': 'DOP rate',
  'Fuente de la tasa': 'Rate source', 'Fecha de la tasa': 'Rate date',
  'Indique la tasa revisada. Para documentos en DOP debe ser 1. El documento conserva esta tasa.': 'Enter the reviewed rate. DOP documents require a rate of 1. The document retains this rate.',
  'Borrador de gasto': 'Expense draft', 'Borrador de factura de proveedor': 'Supplier invoice draft', 'Editar borrador': 'Edit draft',
  'Nuevo gasto de empleado': 'New employee expense', 'Nueva factura de proveedor': 'New supplier invoice', 'Concepto del gasto': 'Expense description',
  'Proveedor': 'Supplier', 'Referencia del proveedor': 'Supplier reference', 'Fecha del gasto': 'Expense date', 'Fecha del documento': 'Document date',
  'Vencimiento': 'Due date', 'Dimensiones operativas opcionales': 'Optional operational dimensions', 'Estación operativa': 'Operating station',
  'Aerolínea': 'Airline', 'Escala': 'Turnaround', 'Servicio': 'Service', 'Líneas del documento': 'Document lines',
  'Cantidad': 'Quantity', 'Precio unitario': 'Unit price', 'Impuesto explícito': 'Explicit tax', 'Quitar línea': 'Remove line',
  'Añadir línea': 'Add line', 'Guardar borrador': 'Save draft', 'Cancelar edición': 'Cancel editing',
  'Total': 'Total', 'Pagado': 'Paid', 'Saldo pendiente': 'Outstanding balance', 'Referencia histórica': 'Historical reference',
  'Total DOP': 'DOP total', 'Línea': 'Line', 'Precio': 'Price', 'Impuesto': 'Tax', 'Historial de revisión': 'Review history',
  'Comprobantes privados': 'Private receipts', 'Sin comprobantes adjuntos.': 'No receipts attached.', 'Descargar comprobante': 'Download receipt',
  'Use PDF, PNG o JPEG de hasta 8 MB.': 'Use PDF, PNG or JPEG up to 8 MB.', 'Adjuntar comprobante privado': 'Attach private receipt',
  'Subir comprobante': 'Upload receipt', 'PDF, PNG o JPEG · máximo 8 MB': 'PDF, PNG or JPEG · maximum 8 MB',
  'Confirmar revisión del documento': 'Confirm document review', 'Motivo de la decisión': 'Decision reason',
  'Confirmar decisión': 'Confirm decision', 'Cancelar decisión': 'Cancel decision',
  'No tiene un empleado activo ni acceso a revisión de gastos.': 'You have no active employee record or expense review access.',
  'Revisión de departamento': 'Department review', 'Vista de gastos': 'Expense view', 'Mis gastos': 'My expenses', 'Todos los gastos': 'All expenses',
  'No hay un empleado activo vinculado a su cuenta.': 'No active employee is linked to your account.',
  'Gestión Humana debe vincular su registro laboral antes de crear gastos.': 'Human Resources must link your employee record before you can create expenses.',
  'Sin gastos para estos filtros.': 'No expenses match these filters.',
  'Los solicitantes ven sus gastos y los administradores revisan los de su departamento.': 'Requesters see their own expenses; administrators review their department expenses.',
  'Gasto': 'Expense', 'Empleado / departamento': 'Employee / department', 'Saldo': 'Balance', 'Cargando gasto…': 'Loading expense…',
  'Detalle de gasto': 'Expense details', 'Empleado': 'Employee', 'Enviar gasto al departamento': 'Submit expense to department',
  'Aprobar departamento': 'Approve for department', 'Aprobar Finanzas': 'Approve for Finance', 'Rechazar gasto': 'Reject expense',
  'Registrar reembolso': 'Record reimbursement', 'Adjunte un comprobante para enviar el gasto a revisión.': 'Attach a receipt before submitting the expense for review.',
  'Reembolsos registrados': 'Recorded reimbursements', 'Aplicado al gasto': 'Applied to expense',
  'Department': 'Department', 'Finance': 'Finance', 'Submitted': 'Submitted', 'DepartmentApproved': 'Department approved',
  'Approved': 'Approved', 'Rejected': 'Rejected',
  'Fecha del pago': 'Payment date', 'Referencia del pago': 'Payment reference',
  'Importe del pago': 'Payment amount', 'Cancelar pago': 'Cancel payment',
  'Registrar pago a proveedor': 'Record supplier payment', 'Reembolsar gasto aprobado': 'Reimburse approved expense',
  'Registrar pago al proveedor': 'Record supplier payment', 'Tasa al gasto': 'Expense exchange rate',
  'Indique la tasa': 'Enter the exchange rate', 'A reembolsar': 'To reimburse', 'Confirmar pago': 'Confirm payment',
  'No tiene permiso para realizar esta acción.': 'You do not have permission to perform this action.',
  'La sesión expiró. Vuelva a iniciar sesión.': 'Your session expired. Please sign in again.',
  'El documento, su versión o el saldo cambió. Revise los datos actualizados antes de continuar.': 'The document, its version or balance changed. Review the updated data before continuing.',
  'El documento ya no está disponible en su ámbito.': 'The document is no longer available within your access scope.',
  'Revise los campos, la tasa de cambio y los comprobantes requeridos.': 'Review the fields, exchange rate and required receipts.',
  'No se pudo conectar o completar la operación. Intente de nuevo.': 'The connection or operation failed. Please try again.',
  'Operación guardada.': 'Operation saved.',
};

export function ExpenseLocaleProvider({ enabled, children }) {
  return <ExpenseLocaleContext.Provider value={enabled}>{children}</ExpenseLocaleContext.Provider>;
}

/** Only authored labels are passed here; API names, notes and descriptions remain untouched. */
export function usePayablesText(enabled = false) {
  const inherited = useContext(ExpenseLocaleContext);
  const { language } = useTranslation(messages);
  const active = enabled || inherited;
  const translated = active && language === 'en';
  const text = value => {
    if (!active || typeof value !== 'string') return value;
    if (!translated) return Object.hasOwn(spanish, value) ? spanish[value] : value;
    if (Object.hasOwn(english, value)) return english[value];
    const line = /^(Descripción de línea |Quitar línea |(.+) de línea )(\d+)$/.exec(value);
    if (line) return `${line[1] === 'Descripción de línea ' ? 'Line description ' : line[1] === 'Quitar línea ' ? 'Remove line ' : `${english[line[2]] ?? line[2]} for line `}${line[3]}`;
    return value;
  };
  text.locale = translated ? 'en-US' : 'es-DO';
  return text;
}
