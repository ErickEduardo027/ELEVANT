import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { readStoredMobileSession } from './mobile-session';

export const OPERATION_EVIDENCE_PREFIX = 'elevant:mobile:operation-evidence:v1:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type EvidencePhoto = Readonly<{
  id: string;
  localUri: string;
  createdAt: string;
}>;
export type OperationEvidenceDraft = Readonly<{
  responsibleName: string;
  bridgeKeyDelivered: boolean;
  observations: string;
  signaturePaths: readonly string[];
  photos: readonly EvidencePhoto[];
  updatedAt: string;
}>;

const emptyDraft = (): OperationEvidenceDraft => ({
  responsibleName: '',
  bridgeKeyDelivered: false,
  observations: '',
  signaturePaths: [],
  photos: [],
  updatedAt: new Date().toISOString(),
});

async function identity() {
  const session = await readStoredMobileSession();
  if (session.kind !== 'active' || typeof session.metadata !== 'object' || !session.metadata) {
    throw new Error('session_unavailable');
  }
  const actor = (session.metadata as { actor?: { accountId?: string } }).actor;
  if (!actor?.accountId || !uuid.test(actor.accountId)) throw new Error('session_unavailable');
  return actor.accountId.toLowerCase();
}

async function keyFor(operationId: string) {
  if (!uuid.test(operationId)) throw new Error('invalid_operation');
  return `${OPERATION_EVIDENCE_PREFIX}${await identity()}:${operationId.toLowerCase()}`;
}

export async function readOperationEvidence(operationId: string): Promise<OperationEvidenceDraft> {
  const raw = await AsyncStorage.getItem(await keyFor(operationId));
  if (!raw) return emptyDraft();
  const value = JSON.parse(raw) as OperationEvidenceDraft;
  return {
    responsibleName: typeof value.responsibleName === 'string' ? value.responsibleName : '',
    bridgeKeyDelivered: value.bridgeKeyDelivered === true,
    observations: typeof value.observations === 'string' ? value.observations : '',
    signaturePaths: Array.isArray(value.signaturePaths)
      ? value.signaturePaths.filter(path => typeof path === 'string') : [],
    photos: Array.isArray(value.photos) ? value.photos.filter(photo =>
      photo && typeof photo.id === 'string' && typeof photo.localUri === 'string' &&
      typeof photo.createdAt === 'string') : [],
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
}

export async function saveOperationEvidence(
  operationId: string,
  input: Omit<OperationEvidenceDraft, 'updatedAt'>,
) {
  const value = { ...input, updatedAt: new Date().toISOString() };
  await AsyncStorage.setItem(await keyFor(operationId), JSON.stringify(value));
  return value;
}

export async function importEvidencePhoto(operationId: string, sourceUri: string) {
  const accountId = await identity();
  const id = Crypto.randomUUID();
  const directory = `${FileSystem.documentDirectory}elevant-evidence/${accountId}/${operationId.toLowerCase()}/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const extension = sourceUri.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/)?.[1]?.toLowerCase() ?? 'jpg';
  const localUri = `${directory}${id}.${extension}`;
  await FileSystem.copyAsync({ from: sourceUri, to: localUri });
  return { id, localUri, createdAt: new Date().toISOString() } satisfies EvidencePhoto;
}

export async function removeEvidencePhoto(photo: EvidencePhoto) {
  await FileSystem.deleteAsync(photo.localUri, { idempotent: true });
}
