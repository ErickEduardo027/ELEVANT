import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageScope } from '../../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../../i18n/languageStore';
import { STAND_STATE_KEYS } from '../../../occ-ui/statusVocabulary';
import OccLegendButton from './OccLegendButton';

function legend() {
  return <LanguageScope><OccLegendButton /></LanguageScope>;
}

async function openLegend(name) {
  await userEvent.click(screen.getByRole('button', { name }));
  return screen.getByRole('dialog', { name });
}

// What a row says, without the markup around its words.
const wordsOf = item => [...item.querySelectorAll('span')].filter(span => span.children.length === 0)
  .map(span => span.textContent);

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

describe('OccLegendButton', () => {
  it('lists the seven stand states with their shape and word', async () => {
    render(legend());
    // The content mounts with the panel only.
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    const dialog = await openLegend('Leyenda');
    const items = within(within(dialog).getByRole('list', { name: 'Posiciones' })).getAllByRole('listitem');
    expect(items.map(item => item.textContent)).toEqual([
      'Libre', 'Planificada', 'Llegando', 'Ocupada', 'Por liberar', 'Inhabilitada', 'Sin verificar',
    ]);
    items.forEach((item, index) => {
      const swatch = item.querySelector('svg[data-stand-state]');
      expect(swatch).toHaveAttribute('data-stand-state', STAND_STATE_KEYS[index]);
      // The word is next to it, so the drawing is not read out twice.
      expect(swatch).toHaveAttribute('aria-hidden', 'true');
    });
    // Seven different drawings: no two states share a shape.
    const drawings = items.map(item => item.querySelector('svg').innerHTML.replace(/occ-swatch-[\w-]+/g, 'pattern'));
    expect(new Set(drawings).size).toBe(7);
  });

  it('lists the three signals with their glyph and word', async () => {
    render(legend());
    const dialog = await openLegend('Leyenda');
    const items = within(within(dialog).getByRole('list', { name: 'Señales' })).getAllByRole('listitem');
    expect(items.map(item => item.textContent)).toEqual(['Urgente', 'Atención', 'Aviso']);
    expect(items.map(item => item.querySelector('svg').dataset.shape)).toEqual(['octagon', 'triangle', 'diamond']);
    for (const item of items) expect(item.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('lists the tags Demo, est., No oficial and Sin actualizar', async () => {
    render(legend());
    const dialog = await openLegend('Leyenda');
    const items = within(within(dialog).getByRole('list', { name: 'Marcas' })).getAllByRole('listitem');
    expect(items.map(wordsOf)).toEqual([
      ['Demo', 'Simulado para la demostración'],
      ['est.', 'Calculado, no medido'],
      ['No oficial', 'Dato de referencia, no oficial'],
      ['Sin actualizar', 'Muestra el último dato recibido'],
    ]);
    expect(items.map(item => item.querySelector('svg').dataset.tag)).toEqual(['demo', 'estimated', 'unofficial', 'stale']);
    // «Demo» keeps its 45° stripes, drawn as an SVG pattern.
    expect(items[0].querySelector('pattern')).toHaveAttribute('patternTransform', 'rotate(45)');
  });

  it('switches to English', async () => {
    resetLanguageForTests('en');
    render(legend());
    const dialog = await openLegend('Legend');
    const words = name => within(within(dialog).getByRole('list', { name })).getAllByRole('listitem');
    expect(words('Stands').map(item => item.textContent)).toEqual([
      'Free', 'Planned', 'Arriving', 'Occupied', 'Releasing', 'Disabled', 'Unverified',
    ]);
    expect(words('Signals').map(item => item.textContent)).toEqual(['Urgent', 'Attention', 'Notice']);
    expect(words('Tags').map(item => wordsOf(item)[0])).toEqual(['Demo', 'est.', 'Unofficial', 'Not updated']);
  });

  it('opens from the keyboard and closes with Esc, back on its button', async () => {
    render(legend());
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Leyenda' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leyenda' })).toHaveFocus();
  });
});
