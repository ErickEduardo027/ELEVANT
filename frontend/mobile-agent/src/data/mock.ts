export type Flight = {
  id: string;
  number: string;
  airline: string;
  origin: string;
  destination: string;
  aircraft: string;
  position: string;
  arrival: string;
  departure: string;
  flightStatus: FlightStatus;
  services: string[];
};

export type FlightStatus =
  | 'Programado'
  | 'Resultado desconocido'
  | 'Cancelado'
  | 'Desviado'
  | 'En rodaje / Salió de puerta'
  | 'Programado / Retrasado'
  | 'Retrasado'
  | 'Llegó al aeropuerto'
  | 'Aterrizó / En rodaje'
  | 'Llegó a la puerta'
  | 'En ruta'
  | 'En ruta / A tiempo';

export const operationAllowedFlightStatuses: FlightStatus[] = [
  'Llegó al aeropuerto', 'Aterrizó / En rodaje', 'Llegó a la puerta',
];

export const canOperateFlight = (status: FlightStatus) => operationAllowedFlightStatuses.includes(status);

export const flights: Flight[] = [
  {
    id: 'B61015', number: 'B6 1015', airline: 'JetBlue', origin: 'JFK', destination: 'PUJ',
    aircraft: 'Airbus A320', position: 'Puerta B12', arrival: '14:35', departure: '16:05', flightStatus: 'Llegó a la puerta',
    services: ['Puente de abordaje', 'Equipaje', 'GPU', 'Agua potable'],
  },
  {
    id: 'AA2401', number: 'AA 2401', airline: 'American Airlines', origin: 'MIA', destination: 'PUJ',
    aircraft: 'Boeing 737-800', position: 'Puerta B08', arrival: '15:10', departure: '16:40', flightStatus: 'Programado',
    services: ['Puente de abordaje', 'Limpieza de cabina', 'Equipaje'],
  },
  {
    id: 'DL1826', number: 'DL 1826', airline: 'Delta', origin: 'ATL', destination: 'PUJ',
    aircraft: 'Airbus A321', position: 'Puerta A04', arrival: '16:25', departure: '17:55', flightStatus: 'Llegó a la puerta',
    services: ['Puente de abordaje', 'GPU', 'Aire acondicionado'],
  },
];

export type ChecklistSection = { id: string; title: string; items: string[] };

export const checklistSections: ChecklistSection[] = [
  { id: 'preuso', title: 'Chequeo preuso', items: [
    'Exterior completo del puente', 'Escalera de servicio', 'Tobogán de equipaje',
    'Cables y mangueras en posición', 'Interior completo del puente', 'Prueba del autonivelador',
    'Botón de prueba de lámparas', 'Luces del puente', 'Cadena de seguridad',
    'Puerta corrediza del puente', 'Extender y retraer puente', 'Subida y bajada del puente',
    'Giro izquierdo y derecho de cabina',
  ]},
  { id: 'llegada', title: 'Antes de la llegada', items: [
    'Canopy retraído', 'Autonivelador retraído', 'Botón de prueba de lámparas', 'Luces encendidas',
    'Puente en posición de parqueo', 'Nivelar puente al tipo de avión', 'Cables y mangueras en posición',
    'Equipos fuera del alcance del puente', 'Cadena en posición', 'Puerta enrollable abierta',
    'Confirmación de rampa', 'Sonar timbre del puente', 'Mover puente al avión',
  ]},
  { id: 'salida', title: 'Antes de la salida', items: [
    'Confirmación de rampa', 'Cable GPU desactivado', 'Manguera de aire desactivada',
    'Subida y bajada de cables GPU', 'Gomas perpendiculares al avión', 'Puerta del avión cerrada',
    'Retraer autonivelador', 'Retraer canopy', 'Sonar timbre del puente', 'Retirar el puente',
  ]},
  { id: 'posterior', title: 'Después de la salida', items: [
    'Sonar timbre del puente', 'Girar cabina a posición', 'Posicionar puente en parqueo',
    'Cadena en posición', 'Cerrar puerta enrollable', 'Nivelar puente al A320',
    'Colocar llave en OFF', 'Quitar y guardar llave', 'Apagar luces del puente',
  ]},
];
