// Copy of the OCC map (Spanish first, with English for the OCC screens). The names of the four views are not here:
// they come with their keys from src/features/occ-ui/occShortcuts.js, and the stand states and tags from
// src/features/occ-ui/statusVocabulary.js, so every screen uses the same words.
export const mapMessages = {
  es: {
    map: { label: 'Mapa del OCC' },
    view: { group: 'Vista del mapa' },
    legend: {
      title: 'Leyenda',
      show: 'Mostrar leyenda',
      hide: 'Ocultar leyenda',
      unofficial: 'Ubicación de referencia interna, sin verificar',
      group: 'Grupo de posiciones',
      groupHint: 'Acerca el mapa para ver cada una',
      flight: 'Vuelo',
      flightHint: 'Apunta según su rumbo; al norte si no se conoce',
    },
    // Every map shows it, also those that draw no stand (Monitoreo) or a view that hides them (region, approach), so it
    // does not name what is drawn.
    basemap: {
      degraded: 'No se pudo cargar el mapa base. Los datos de ELEVANT siguen en el mapa.',
    },
    unavailable: {
      title: 'El mapa no está disponible',
      description: 'Este navegador no puede dibujar el mapa. Puedes elegir desde la lista.',
      list: 'Lista del mapa',
      stands: 'Posiciones del mapa',
      flights: 'Vuelos del mapa',
    },
    attribution: { aircraftData: 'Datos de aeronaves' },
    controls: {
      zoomIn: 'Acercar',
      zoomOut: 'Alejar',
      resetBearing: 'Arrastra para girar el mapa o haz clic para volver al norte',
      attribution: 'Mostrar u ocultar los créditos del mapa',
      nauticalMiles: 'NM',
    },
  },
  en: {
    map: { label: 'OCC map' },
    view: { group: 'Map view' },
    legend: {
      title: 'Legend',
      show: 'Show legend',
      hide: 'Hide legend',
      unofficial: 'Internal reference location, not verified',
      group: 'Group of stands',
      groupHint: 'Zoom in to see each one',
      flight: 'Flight',
      flightHint: 'Points along its heading; north when unknown',
    },
    basemap: {
      degraded: 'The base map could not be loaded. ELEVANT data is still on the map.',
    },
    unavailable: {
      title: 'The map is not available',
      description: 'This browser cannot draw the map. You can choose from the list.',
      list: 'Map list',
      stands: 'Stands on the map',
      flights: 'Flights on the map',
    },
    attribution: { aircraftData: 'Aircraft data' },
    controls: {
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      resetBearing: 'Drag to rotate the map or click to return to north',
      attribution: 'Show or hide the map credits',
      nauticalMiles: 'NM',
    },
  },
};
