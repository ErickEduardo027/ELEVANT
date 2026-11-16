import { describe, expect, it } from 'vitest';
import { DOCUMENT_TITLES, SIGNER_ROLES } from '../../services/occDocumentsService';
import { SUBMISSION_STATUS_LABELS } from '../operations/operationLabels';
import { reviewMessages } from './reviewMessages';

// Every leaf of a message tree as a dotted path, sorted.
function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`)
    : [`${prefix}${key}`])).sort();
}

const textAt = (messages, path) => path.split('.').reduce((node, key) => node[key], messages);
const placeholdersOf = text => [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();

describe('reviewMessages', () => {
  it('es and en carry the same keys, the same placeholders and no empty text', () => {
    const paths = leafPaths(reviewMessages.es);
    expect(leafPaths(reviewMessages.en)).toEqual(paths);
    for (const path of paths) {
      for (const language of ['es', 'en']) {
        const text = textAt(reviewMessages[language], path);
        expect(typeof text === 'string' && text.trim().length > 0, `${language}: ${path}`).toBe(true);
      }
      expect(placeholdersOf(textAt(reviewMessages.en, path)), path).toEqual(placeholdersOf(textAt(reviewMessages.es, path)));
    }
  });

  it('names the queue, its filters and the detail placeholder, and has no eyebrow or subtitle', () => {
    expect(reviewMessages.es.queue.title).toBe('Entregas');
    expect(reviewMessages.es.queue.filters).toEqual({
      label: 'Filtrar entregas', all: 'Todas', pending: 'Por revisar',
      empty: 'No hay entregas por revisar con este filtro.',
    });
    expect(reviewMessages.es.detail.placeholder).toBe('Elige una entrega de la lista para ver su detalle.');
    for (const language of ['es', 'en']) {
      expect(reviewMessages[language]).not.toHaveProperty('eyebrow');
      expect(reviewMessages[language]).not.toHaveProperty('subtitle');
    }
  });

  it('takes its Spanish states, form titles and signer roles from their one source', () => {
    expect(reviewMessages.es.status).toBe(SUBMISSION_STATUS_LABELS);
    expect(reviewMessages.es.documents.titles).toBe(DOCUMENT_TITLES);
    expect(reviewMessages.es.documents.roles).toBe(SIGNER_ROLES);
  });
});
