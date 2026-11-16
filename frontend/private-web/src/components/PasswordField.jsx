import { useState } from 'react';
import './PasswordField.css';

export default function PasswordField({ label, id, fieldClassName = '', labelClassName = '', inputClassName = '', showVerb = 'Mostrar', hideVerb = 'Ocultar', ...inputProps }) {
  const [visible, setVisible] = useState(false);
  return <div className={fieldClassName}>
    <label htmlFor={id} className={labelClassName}>{label}</label>
    <div className="elevant-password-field">
      <input {...inputProps} id={id} type={visible ? 'text' : 'password'} className={`${inputClassName} elevant-password-field__input`} />
      <button type="button" className="elevant-password-field__toggle" aria-label={`${visible ? hideVerb : showVerb} ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(value => !value)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="3" />
          {!visible && <path d="M3 3 21 21" />}
        </svg>
      </button>
    </div>
  </div>;
}
