import { useEffect, useId, useRef, useState } from 'react';
import { PRESENCE_MESSAGE_MAX_LENGTH } from '@elevant/api-client';
import { useTranslation } from '../../i18n/LanguageScope';
import { PresenceDot } from './PresencePeople';
import { presenceMessages, resolvePresence, SELECTABLE_AVAILABILITIES } from './presenceStatus';
import useOwnPresence from './useOwnPresence';
import styles from './PresencePeople.module.css';

const ownPresence = own => own?.availability === 'appearOffline' ? 'offline'
  : own?.availability ?? resolvePresence(own ? { state: own.state } : null);

export default function PresenceStatusPicker() {
  const { t } = useTranslation(presenceMessages);
  const presence = useOwnPresence();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const anchor = useRef(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  const id = useId();
  const own = presence.own;

  useEffect(() => {
    if (!open) return undefined;
    (panel.current?.querySelector('[aria-checked="true"]') ?? panel.current?.querySelector('button, input'))?.focus();
    const outside = event => { if (!anchor.current?.contains(event.target)) setOpen(false); };
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
  }, [open]);

  if (presence.status === 'unsupported') return null;
  const current = ownPresence(own);
  const message = draft ?? own?.message ?? '';
  const choose = availability => { void presence.update({ availability, message: own?.message ?? null }); };
  const saveMessage = async value => { if (await presence.update({ availability: own?.availability ?? null, message: value })) setDraft(null); };
  const moveFocus = event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const options = [...event.currentTarget.querySelectorAll('[role="radio"]')];
    const index = options.indexOf(document.activeElement);
    options[(index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
  };

  return <div ref={anchor} className={styles.picker}>
    <button ref={trigger} type="button" className={styles.trigger} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      disabled={presence.status === 'loading'} onClick={() => setOpen(value => !value)}
      aria-label={t('myStatus') + ': ' + t('status.' + current) + (own?.message ? ' · ' + own.message : '')}>
      <span className={styles.triggerDot}><PresenceDot presence={current} /></span>
      <span className={styles.triggerText}>{t('status.' + current)}<small>{own?.availability ? own.message || t('myStatus') : t('automatic')}</small></span>
    </button>
    {open && <section ref={panel} id={id} role="dialog" aria-label={t('myStatus')} className={styles.panel}>
      {presence.status === 'error' && !own ? <div role="alert" className={styles.error}>{t('loadError')}{' '}
        <button type="button" className={styles.action} onClick={() => presence.retry()}>{t('retry')}</button></div> : <>
        <div role="radiogroup" aria-label={t('myStatus')} onKeyDown={moveFocus}>{SELECTABLE_AVAILABILITIES.map(value =>
          <button key={value} type="button" role="radio" aria-checked={own?.availability === value} disabled={presence.saving}
            tabIndex={(own?.availability ?? SELECTABLE_AVAILABILITIES[0]) === value ? 0 : -1}
            className={styles.option} onClick={() => choose(value)}>
            <span className={styles.triggerDot}><PresenceDot presence={value === 'appearOffline' ? 'offline' : value} /></span>{t('choose.' + value)}
          </button>)}</div>
        {own?.availability && <button type="button" className={styles.option} disabled={presence.saving} onClick={() => choose(null)}>{t('reset')}</button>}
        <div className={styles.separator} />
        <form className={styles.form} onSubmit={event => { event.preventDefault(); void saveMessage(message); }}>
          <label htmlFor={id + '-message'}>{t('message')}</label>
          <input id={id + '-message'} className={styles.field} value={message} maxLength={PRESENCE_MESSAGE_MAX_LENGTH}
            placeholder={t('messagePlaceholder')} aria-describedby={id + '-hint'} onChange={event => setDraft(event.target.value)} />
          <p id={id + '-hint'} className={styles.hint}>{t('messageHint', { max: PRESENCE_MESSAGE_MAX_LENGTH })}</p>
          <div className={styles.formActions}>
            {own?.message && <button type="button" className={styles.action} disabled={presence.saving} onClick={() => void saveMessage(null)}>{t('clear')}</button>}
            <button type="submit" className={styles.action} disabled={presence.saving || message.trim() === (own?.message ?? '')}>{presence.saving ? t('saving') : t('save')}</button>
          </div>
        </form>
        <p className={`${styles.notice} px-2 pb-1`}>{t('ephemeral')}</p>
        {presence.error && <p role="alert" className={styles.error}>{t('error')}</p>}
      </>}
    </section>}
  </div>;
}
