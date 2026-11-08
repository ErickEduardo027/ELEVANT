/**
 * Spanish messages of the OCC and Gestión Humana reports by Problem Details code (phase 3, block E, 3-N13). An export
 * carries the whole period or nothing: over its row limit the server refuses it with `report_too_large` instead of
 * cutting it. Screens resolve them with `problemMessage(error, REPORT_PROBLEMS, …)`; the server title is never shown.
 */
export const REPORT_PROBLEMS = Object.freeze({
  report_too_large: 'El reporte supera el máximo de filas exportables. Acote el período o los filtros.',
  invalid_report_query:
    'Revise el período y los filtros: la fecha final no puede ser anterior a la inicial ni superar el intervalo permitido.',
  report_not_found: 'Ese reporte ya no existe; actualice la página.',
  station_unavailable: 'La estación no está disponible para su cuenta.',
});

/** OCC reports: a period of up to one year; a PDF up to 5 000 rows and Excel or CSV up to 25 000. */
export const OCC_REPORT_PROBLEMS = Object.freeze({
  ...REPORT_PROBLEMS,
  invalid_report_query: 'Revise el período: la fecha final no puede ser anterior a la inicial y el máximo es un año.',
});

/** Gestión Humana reports: up to 30 dates and 5 000 rows in both formats. */
export const HUMAN_RESOURCES_REPORT_PROBLEMS = Object.freeze({
  ...REPORT_PROBLEMS,
  report_too_large: 'El reporte supera las 5 000 filas exportables. Acote el intervalo o los filtros antes de exportar.',
  invalid_report_query: 'Revise el intervalo: la fecha final no puede ser anterior a la inicial y el máximo son 30 fechas.',
});
