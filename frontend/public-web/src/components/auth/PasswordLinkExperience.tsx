"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { BrandMark } from "@/components/marketing/BrandMark";
import { useAirlineSession, type AirlineLinkResult } from "./AirlineSessionProvider";

import styles from "./AuthExperience.module.css";

type Mode = "activate" | "reset";

const MINIMUM_PASSWORD = 14;

const COPY: Record<Mode, { kicker: string; title: string; lead: string; action: string; done: string }> = {
  activate: {
    kicker: "Activación de cuenta",
    title: "Crea la contraseña de tu cuenta.",
    lead: "Al guardarla confirmamos tu correo y la cuenta queda lista para entrar al portal.",
    action: "Activar cuenta",
    done: "Cuenta activada. Ya puedes iniciar sesión; te enviaremos un código a tu correo.",
  },
  reset: {
    kicker: "Recuperación de contraseña",
    title: "Elige una contraseña nueva.",
    lead: "Al guardarla se cierran todas las sesiones abiertas de tu cuenta.",
    action: "Guardar contraseña",
    done: "Contraseña actualizada. Inicia sesión con la contraseña nueva.",
  },
};

function linkMessage(result: Exclude<AirlineLinkResult, { ok: true }>, mode: Mode): string {
  switch (result.reason) {
    case "invalid-link": return mode === "activate"
      ? "El enlace no es válido, ya se usó o venció. Pide a AVIAM que reenvíe la invitación."
      : "El enlace no es válido, ya se usó o venció. Solicita uno nuevo.";
    case "policy": return "La contraseña no cumple la política de seguridad: usa al menos 14 caracteres y evita contraseñas comunes.";
    case "rate-limited": return "Demasiados intentos. Espera un momento antes de reintentar.";
    case "unavailable": return "No se pudo conectar con la API. Reintenta en unos minutos.";
  }
}

export function PasswordLinkExperience({ mode, token }: { mode: Mode; token?: string }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <BrandMark compact />
        <Link className={styles.backLink} href="/login">Volver al acceso</Link>
      </header>
      <main className={styles.main} id="auth-content">
        <section className={styles.formRegion} aria-label={COPY[mode].kicker}>
          <div className={styles.formShell}>
            {token ? <SetPasswordForm mode={mode} token={token} />
              : mode === "reset" ? <RequestResetForm />
                : <p role="alert">El enlace de activación está incompleto. Ábrelo de nuevo desde el correo.</p>}
          </div>
        </section>
      </main>
    </div>
  );
}

function SetPasswordForm({ mode, token }: { mode: Mode; token: string }) {
  const { activateAccount, resetPassword } = useAirlineSession();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const copy = COPY[mode];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < MINIMUM_PASSWORD || password !== confirmation) {
      setMessage({ kind: "error", text: "La contraseña debe tener al menos 14 caracteres y coincidir con la confirmación." });
      return;
    }
    setPending(true);
    const result = await (mode === "activate" ? activateAccount(token, password) : resetPassword(token, password));
    setPending(false);
    if (result.ok) {
      setDone(true);
      setPassword("");
      setConfirmation("");
      setMessage({ kind: "info", text: copy.done });
    } else {
      setMessage({ kind: "error", text: linkMessage(result, mode) });
    }
  };

  return (
    <div className={styles.tabPanel} role="region" aria-labelledby="link-heading">
      <header className={styles.formHeader}>
        <p className={styles.formKicker}>{copy.kicker}</p>
        <h2 id="link-heading">{copy.title}</h2>
        <p>{copy.lead}</p>
      </header>
      {!done && <form className={styles.form} onSubmit={submit} noValidate>
        <PasswordInput id="link-password" label="Contraseña nueva" value={password} onChange={setPassword} />
        <PasswordInput id="link-confirmation" label="Confirmar contraseña" value={confirmation} onChange={setConfirmation} />
        {message && <Feedback {...message} />}
        <button className={styles.primaryButton} type="submit" disabled={pending}>
          {pending ? "Guardando…" : copy.action}
        </button>
      </form>}
      {done && <>
        {message && <Feedback {...message} />}
        <Link className={styles.primaryButton} href="/login">Ir a iniciar sesión</Link>
      </>}
    </div>
  );
}

function RequestResetForm() {
  const { requestPasswordReset } = useAirlineSession();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setMessage({ kind: "error", text: "Escribe un correo válido." });
      return;
    }
    setPending(true);
    const result = await requestPasswordReset(email);
    setPending(false);
    // The answer never says whether the email has an account.
    setMessage(result.ok
      ? { kind: "info", text: "Si el correo pertenece a una cuenta del portal, recibirás un enlace válido por 30 minutos." }
      : { kind: "error", text: "No se pudo enviar la solicitud. Reintenta en unos minutos." });
  };

  return (
    <div className={styles.tabPanel} role="region" aria-labelledby="reset-heading">
      <header className={styles.formHeader}>
        <p className={styles.formKicker}>{COPY.reset.kicker}</p>
        <h2 id="reset-heading">¿Olvidaste tu contraseña?</h2>
        <p>Escribe el correo de tu cuenta y te enviaremos un enlace para crear una nueva.</p>
      </header>
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.field}>
          <div className={styles.labelRow}><label htmlFor="reset-email">Correo corporativo</label></div>
          <input id="reset-email" name="email" type="email" autoComplete="email" value={email}
            onChange={(event) => { setEmail(event.currentTarget.value); setMessage(null); }} required />
        </div>
        {message && <Feedback {...message} />}
        <button className={styles.primaryButton} type="submit" disabled={pending}>
          {pending ? "Enviando…" : "Enviar enlace"}
        </button>
      </form>
    </div>
  );
}

function PasswordInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange(value: string): void }) {
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}><label htmlFor={id}>{label}</label></div>
      <input id={id} type="password" autoComplete="new-password" value={value} minLength={MINIMUM_PASSWORD}
        onChange={(event) => onChange(event.currentTarget.value)} required />
    </div>
  );
}

function Feedback({ kind, text }: { kind: "info" | "error"; text: string }) {
  return (
    <div className={styles.feedback} data-kind={kind} role={kind === "error" ? "alert" : "status"}>
      <p>{text}</p>
    </div>
  );
}
