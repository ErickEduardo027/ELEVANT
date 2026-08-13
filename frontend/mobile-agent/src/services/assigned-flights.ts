import AsyncStorage from '@react-native-async-storage/async-storage';
import { Flight, FlightStatus } from '../data/mock';
import { getMobileSession, MOBILE_API_URL } from './mobile-auth';

const CACHE_KEY = 'elevant:assigned-flights';
const STATUS: Record<string, FlightStatus> = {
  scheduled: 'Programado', delayed: 'Programado / Retrasado', cancelled: 'Cancelado', diverted: 'Desviado',
  taxiing: 'Aterrizó / En rodaje', landed: 'Aterrizó / En rodaje', arrived: 'Llegó al aeropuerto',
  gateArrival: 'Llegó a la puerta', enRoute: 'En ruta', enRouteOnTime: 'En ruta / A tiempo', unknown: 'Resultado desconocido',
};

function clock(value?: string) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
}

function mapFlight(item: any): Flight {
  return {
    id: item.id, number: item.flightNumber, airline: item.airlineName,
    origin: item.origin, destination: item.destination, aircraft: item.aircraftType,
    position: item.position ? `Puerta ${item.position}` : 'Sin puerta', arrival: clock(item.estimatedTime),
    departure: clock(item.scheduledTime), flightStatus: STATUS[item.status] ?? 'Resultado desconocido',
    services: item.services ?? [],
  };
}

export async function refreshAssignedFlights(): Promise<Flight[]> {
  const session = await getMobileSession();
  if (!session?.token) return [];
  try {
    const response = await fetch(`${MOBILE_API_URL}/api/mobile/flights`, { headers: { Authorization: `Bearer ${session.token}` } });
    const payload = await response.json().catch(() => ([]));
    if (!response.ok) throw new Error(payload.error || 'No fue posible consultar las asignaciones.');
    const mapped = payload.map(mapFlight);
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(mapped));
    return mapped;
  } catch {
    return getCachedAssignedFlights();
  }
}

export async function getCachedAssignedFlights(): Promise<Flight[]> {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as Flight[]; } catch { return []; }
}

export async function getAssignedFlight(flightId: string): Promise<Flight | undefined> {
  const flights = await getCachedAssignedFlights();
  return flights.find(flight => flight.id === flightId);
}
