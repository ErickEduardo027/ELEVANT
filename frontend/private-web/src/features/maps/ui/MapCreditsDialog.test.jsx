import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../../../public/models/aircraft/manifest.json';
import logos from '../../../../public/models/liveries/logos/logos.json';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { isOverlayOpen } from '../../occ-ui/occShortcuts';
import { logoCredits, modelCredits } from '../core/credits';
import MapCreditsDialog from './MapCreditsDialog';

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

const CREDITS = Object.freeze({ models: modelCredits(manifest), logos: logoCredits(logos) });
const ADSB = { name: 'adsb.fi', homeUrl: 'https://adsb.fi/', licenseName: 'Uso personal', licenseUrl: 'https://adsb.fi/terms' };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// A map's attribution in miniature: the link that opens the dialog, and the dialog.
function Host({ loader, aircraftSource = null }) {
  const [open, setOpen] = useState(false);
  const link = useRef(null);
  return (
    <LanguageScope>
      <a ref={link} href="#creditos-del-mapa" role="button" onClick={event => { event.preventDefault(); setOpen(true); }}>
        Créditos y licencias
      </a>
      <MapCreditsDialog open={open} onClose={() => setOpen(false)} loader={loader} aircraftSource={aircraftSource} />
    </LanguageScope>
  );
}

const openDialog = async () => {
  const link = screen.getByRole('button', { name: 'Créditos y licencias' });
  link.focus();
  await act(async () => { fireEvent.click(link); });
  return screen.getByRole('dialog', { name: 'Créditos y licencias' });
};

describe('MapCreditsDialog (PR M5)', () => {
  it('is a modal dialog in Spanish with the models, the logos and the data, reading the files once', async () => {
    const loader = vi.fn(() => Promise.resolve(CREDITS));
    render(<Host loader={loader} aircraftSource={ADSB} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = await openDialog();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/modelos 3D, logotipos, datos y teselas/);
    // Drawn on the body, outside the map's layout container, inside a wrapper with the OCC scope so its tokens,
    // light theme and focus ring resolve (review of 2026-11-28).
    const scope = dialog.closest('[data-occ-dialog]').parentElement;
    expect(scope.parentElement).toBe(document.body);
    expect(scope).toHaveAttribute('data-department', 'occ');
    expect(dialog.closest("[data-department='occ']")).toBe(scope);
    expect(isOverlayOpen(document)).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);

    expect(within(dialog).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['Modelos 3D de aviones', 'Logotipos de aerolíneas', 'Datos y mapas base']);

    // One article per model, named by its type, with base, authors, source, upstream, licence, modification and files.
    const models = within(dialog).getByRole('region', { name: 'Modelos 3D de aviones' });
    expect(within(models).getAllByRole('article')).toHaveLength(22);
    const b738 = within(models).getByRole('article', { name: 'B738 · Boeing 737-800' });
    expect(b738).toHaveTextContent('Modelo baseBoeing 737-800');
    expect(b738).toHaveTextContent(/AutoríaAleksei Kalmykov \(kalmykov\) \/ Flightradar24.*mbr1376/);
    expect(b738).toHaveTextContent('Licencia');
    expect(b738).toHaveTextContent('GPL-2.0-only');
    expect(b738).toHaveTextContent('Modificado: 2026-11-27, ELEVANT / AVIAM');
    const source = within(b738).getByRole('link', { name: 'mbr1376/fr24-3d-models' });
    expect(source).toHaveAttribute('href', manifest.types.B738.credit.sourceUrl);
    expect(source).toHaveAttribute('rel', 'noopener noreferrer');
    expect(b738).toHaveTextContent(`commit ${manifest.types.B738.credit.commit.slice(0, 7)}`);
    expect(within(b738).getByRole('link', { name: 'FGMEMBERS/737-800' })).toHaveAttribute('href', 'https://github.com/FGMEMBERS/737-800');
    const files = within(b738).getByRole('list', { name: 'Archivos del B738' });
    expect(within(files).getAllByRole('link').map(anchor => [anchor.textContent, anchor.getAttribute('href')])).toEqual([
      ['LICENSE', '/models/aircraft/B738/LICENSE'], ['NOTICE.md', '/models/aircraft/B738/NOTICE.md'],
      ['SOURCE.md', '/models/aircraft/B738/SOURCE.md'],
    ]);
    expect(within(b738).getByText('Cambios del B738').closest('details')).not.toHaveAttribute('open');

    // A sibling is said to be adjusted; the ATR keeps GPL-3.0 and its upstream as text.
    const b38m = within(models).getByRole('article', { name: /^B38M · / });
    expect(b38m).toHaveTextContent('Ajustado a partir del Boeing 737 MAX 9');
    expect(b38m).toHaveTextContent('Original model by omri_ha_muglob');
    const at76 = within(models).getByRole('article', { name: /^AT76 · / });
    expect(at76).toHaveTextContent('GPL-3.0-only');
    expect(within(at76).queryByRole('link', { name: /FlightGear ATR 72-500/ })).toBeNull();
    expect(models).toHaveTextContent('Un tipo sin modelo (como el B763) usa el modelo propio de la app.');
    expect(within(models).queryByRole('article', { name: /^B763 · / })).toBeNull();

    // The logos: public domain below the threshold of originality, trademarks of their owners, demonstrative use.
    const logosRegion = within(dialog).getByRole('region', { name: 'Logotipos de aerolíneas' });
    expect(logosRegion).toHaveTextContent('de dominio público por no alcanzar el umbral de originalidad');
    expect(logosRegion).toHaveTextContent('Son marcas de sus titulares');
    expect(logosRegion).toHaveTextContent('como uso demostrativo y sin afiliación, patrocinio ni aval');
    expect(within(logosRegion).getAllByRole('link', { name: 'Archivo en Commons' })).toHaveLength(12);
    expect(logosRegion).toHaveTextContent('Delta Air Lines (DL) · Archivo en Commons · PD-textlogo + Trademarked');
    expect(logosRegion).toHaveTextContent('llevan su código IATA en la deriva');

    // The data and tiles, with the aircraft data's source of the traffic on screen.
    const data = within(dialog).getByRole('region', { name: 'Datos y mapas base' });
    for (const name of ['© OpenStreetMap contributors', 'OpenFreeMap', '© OpenMapTiles', 'OurAirports', 'NASA GIBS',
      'NOAA Aviation Weather Center', 'Manrope', 'SIL Open Font License 1.1']) {
      expect(within(data).getAllByRole('link', { name }).length, name).toBeGreaterThan(0);
    }
    expect(within(data).getByRole('link', { name: 'adsb.fi' })).toHaveAttribute('href', 'https://adsb.fi/');
    expect(within(data).getByRole('link', { name: 'Uso personal' })).toHaveAttribute('href', 'https://adsb.fi/terms');
    for (const anchor of within(dialog).getAllByRole('link')) {
      expect(anchor.getAttribute('href'), anchor.textContent).toMatch(/^(https:\/\/|\/models\/aircraft\/[A-Z0-9]+\/)/);
      expect(anchor).toHaveAttribute('target', '_blank');
    }
  });

  it('starts on its close button, keeps Tab inside, closes with Esc and gives the focus back to the link', async () => {
    render(<Host loader={() => Promise.resolve(CREDITS)} />);
    const dialog = await openDialog();
    const close = within(dialog).getByRole('button', { name: 'Cerrar' });
    expect(document.activeElement).toBe(close);
    // Shift+Tab from the first control goes to the last one, inside the dialog.
    fireEvent.keyDown(document.activeElement, { key: 'Tab', shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(close);

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { document.activeElement.dispatchEvent(escape); });
    expect(escape.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Créditos y licencias' }));
  });

  it('says it is loading, then offers «Reintentar» after a failure, and lists once it reads', async () => {
    const first = deferred();
    const loader = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(Promise.resolve(CREDITS));
    render(<Host loader={loader} />);
    const dialog = await openDialog();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Cargando créditos…');
    // The data part does not wait for the files, and without traffic it says where the aircraft source shows.
    expect(dialog).toHaveTextContent('OpenFreeMap');
    expect(dialog).toHaveTextContent('se acredita en el mapa mientras hay tráfico en pantalla');

    await act(async () => { first.reject(new Error('503')); });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('No se pudieron cargar los créditos de los modelos y los logotipos.');
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Reintentar' })); });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getAllByRole('article')).toHaveLength(22);
  });

  it('speaks English on an English screen', async () => {
    act(() => resetLanguageForTests('en'));
    render(
      <LanguageScope>
        <MapCreditsDialog open onClose={() => {}} loader={() => Promise.resolve({ models: [], logos: [] })} />
      </LanguageScope>,
    );
    await act(async () => {});
    const dialog = screen.getByRole('dialog', { name: 'Credits and licences' });
    expect(dialog).toHaveTextContent('There are no 3D models in this installation.');
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['Aircraft 3D models', 'Airline logos', 'Data and base maps']);
  });
});
