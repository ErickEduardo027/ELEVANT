"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useState,
} from "react";

import { BrandMark } from "@/components/marketing/BrandMark";
import {
  type MockSignInField,
  type MockSignInInput,
  validateSignIn,
} from "@/lib/mock-auth";
import { useAirlineSession, type AirlineLoginChallenge, type AirlineSignInFailure } from "./AirlineSessionProvider";

import styles from "./AuthExperience.module.css";

type AuthExperienceProps = {
  returnTo?: string;
};

type SignInInputField = keyof MockSignInInput;
type SignInField = MockSignInField;
type SignInErrors = Partial<Record<SignInField, string>>;
type SignInFeedback = {
  message: string;
  kind: "info" | "error";
};

const SIGN_IN_IDS: Record<SignInInputField, string> = {
  email: "auth-email",
  password: "auth-password",
  remember: "auth-remember",
};

const INITIAL_SIGN_IN: MockSignInInput = {
  email: "",
  password: "",
  remember: false,
};

export function AuthExperience({
  returnTo = "/portal",
}: AuthExperienceProps) {
  const router = useRouter();
  const { status } = useAirlineSession();

  useEffect(() => {
    if (status === "ready") router.replace(returnTo);
  }, [returnTo, router, status]);

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#auth-content">
        Saltar al formulario de acceso
      </a>

      <header className={styles.header}>
        <BrandMark compact />
        <Link className={styles.backLink} href="/">
          <ArrowLeftIcon />
          Volver a ELEVANT
        </Link>
      </header>

      <main className={styles.main} id="auth-content">
        <CredentialPanel />

        <section className={styles.formRegion} aria-label="Acceso de aerolíneas">
          <div className={styles.formShell}>
            {status === "loading" || status === "ready" ? (
              <LoadingState />
            ) : (
              <>
                <SignInPanel returnTo={returnTo} />
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export function CredentialPanel() {
  return (
    <aside className={styles.credential} aria-labelledby="auth-title">
      <div className={styles.credentialGrid} aria-hidden="true" />
      <div className={styles.routeOrbit} aria-hidden="true">
        <span />
        <span />
        <PlaneIcon />
      </div>

      <div className={styles.credentialContent}>
        <p className={styles.kicker}>Portal de aerolíneas · Development</p>
        <h1 id="auth-title">La operación, visible para quien debe verla.</h1>
        <p className={styles.credentialLead}>
          Consulta las operaciones de tu aerolínea y las estaciones que la API
          autoriza para tu cuenta.
        </p>

        <div className={styles.routeCard}>
          <div className={styles.routeCardTop}>
            <span>Verificación de acceso</span>
            <strong>API / Development</strong>
          </div>
          <div className={styles.routeCodes}>
            <div>
              <strong>01</strong>
              <span>Cuenta</span>
            </div>
            <div className={styles.routeLine} aria-hidden="true">
              <i />
              <PlaneIcon />
              <i />
            </div>
            <div>
              <strong>02</strong>
              <span>Aerolínea y estaciones</span>
            </div>
          </div>
          <div className={styles.routeCardBottom}>
            <span>Estado</span>
            <strong>
              <i aria-hidden="true" /> Se verifica al iniciar sesión
            </strong>
          </div>
        </div>
      </div>

      <footer className={styles.credentialFootnote}>
        Sin conexión a sistemas de producción
      </footer>
    </aside>
  );
}

function signInFailureMessage(reason: AirlineSignInFailure): string {
  switch (reason) {
    case "invalid": return "No se pudo validar la cuenta. Revisa el correo y la contraseña.";
    case "forbidden": return "Esta cuenta no tiene acceso al portal de aerolíneas.";
    case "context": return "El contexto de esta aerolínea no está disponible en la API.";
    case "password-change-required": return "Debes cambiar la contraseña temporal antes de entrar.";
    case "rate-limited": return "Demasiados intentos. Espera un momento antes de reintentar.";
    case "unavailable": return "No se pudo conectar con la API. Comprueba la conexión y reintenta.";
  }
}

function SignInPanel({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const { signIn, changePassword, verifyLoginCode, resendLoginCode } = useAirlineSession();
  const [challenge, setChallenge] = useState<AirlineLoginChallenge | null>(null);
  const [code, setCode] = useState("");
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!challenge) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [challenge]);
  const [input, setInput] = useState<MockSignInInput>(INITIAL_SIGN_IN);
  const [errors, setErrors] = useState<SignInErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<SignInFeedback | null>(null);
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const update = <Field extends SignInInputField>(
    field: Field,
    value: MockSignInInput[Field],
  ) => {
    setInput((current) => ({ ...current, [field]: value }));
    if (field === "email" || field === "password") {
      setErrors((current) => withoutKey(current, field));
    }
    setFeedback(null);
  };

  const validateField = (field: SignInField) => {
    const result = validateSignIn(input);
    if (result.ok || !result.fieldErrors[field]) {
      setErrors((current) => withoutKey(current, field));
      return;
    }
    setErrors((current) => ({ ...current, [field]: result.fieldErrors[field] }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    const validation = validateSignIn(input);

    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      setFeedback({
        kind: "error",
        message: "Revisa los campos indicados para continuar.",
      });
      focusField(SIGN_IN_IDS, validation.firstInvalidField);
      return;
    }

    setPending(true);
    const result = await signIn({ email: validation.value.email, password: validation.value.password });
    setPending(false);

    if (result.ok) {
      router.replace(returnTo);
    } else if (result.reason === "code-required") {
      setChallenge(result.challenge);
      setCode("");
      setResendAvailableAt(Date.now() + 30_000);
      setFeedback({ kind: "info", message: `Enviamos un código de 6 dígitos a ${result.challenge.emailHint}.` });
    } else {
      if (result.reason === "password-change-required") setPasswordChangeRequired(true);
      setFeedback({ kind: "error", message: signInFailureMessage(result.reason) });
    }
  };

  const submitCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!challenge) return;
    if (!/^\d{6}$/.test(code)) {
      setFeedback({ kind: "error", message: "El código tiene 6 dígitos." });
      return;
    }
    setPending(true);
    const result = await verifyLoginCode(challenge.challengeId, code);
    setPending(false);
    if (result.ok) {
      router.replace(returnTo);
      return;
    }
    setCode("");
    setFeedback({ kind: "error", message: result.reason === "invalid"
      ? "El código no es válido o ya venció. Revisa el último correo o pide uno nuevo."
      : signInFailureMessage(result.reason as AirlineSignInFailure) });
  };

  const resendCode = async () => {
    if (!challenge) return;
    setPending(true);
    const next = await resendLoginCode(challenge.challengeId);
    setPending(false);
    if (!next) {
      setChallenge(null);
      setFeedback({ kind: "error", message: "El código venció o se bloqueó. Inicia sesión de nuevo." });
      return;
    }
    setChallenge(next);
    setCode("");
    setResendAvailableAt(Date.now() + 30_000);
    setFeedback({ kind: "info", message: `Enviamos un código nuevo a ${next.emailHint}. El anterior ya no sirve.` });
  };

  const secondsLeft = challenge ? Math.max(0, Math.ceil((Date.parse(challenge.expiresAt) - now) / 1000)) : 0;
  const resendIn = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));

  const submitPasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 14 || newPassword !== confirmPassword) {
      setFeedback({ kind: "error", message: "La nueva contraseña debe tener al menos 14 caracteres y coincidir con la confirmación." });
      return;
    }
    setPending(true);
    const result = await changePassword({ email: input.email.trim(), currentPassword: input.password, newPassword });
    setPending(false);
    if (!result.ok) {
      const message = result.reason === "invalid" ? "La contraseña actual no es válida."
        : result.reason === "policy" ? "La nueva contraseña no cumple la política de seguridad."
          : result.reason === "rate-limited" ? "Demasiados intentos. Espera antes de reintentar."
            : "No se pudo cambiar la contraseña. Reintenta cuando la API esté disponible.";
      setFeedback({ kind: "error", message });
      return;
    }
    setInput(INITIAL_SIGN_IN);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordChangeRequired(false);
    setFeedback({ kind: "info", message: "Contraseña actualizada. Inicia sesión con tu nueva contraseña." });
  };

  return (
    <div
      className={styles.tabPanel}
      id="login-panel"
      role="region"
      aria-labelledby="login-heading"
      tabIndex={0}
    >
      <header className={styles.formHeader}>
        <p className={styles.formKicker}>Acceso autorizado</p>
        <h2 id="login-heading">Continúa al portal de tu aerolínea.</h2>
        <p>
          Utiliza la cuenta emitida para tu aerolínea. El acceso y las estaciones
          se comprueban con la API de Development.
        </p>
      </header>

      {challenge && <form className={styles.form} onSubmit={submitCode} noValidate aria-labelledby="code-heading">
        <h3 id="code-heading">Código enviado a tu correo</h3>
        <p>Escribe el código de 6 dígitos que enviamos a <strong>{challenge.emailHint}</strong>.</p>
        <Field id="auth-code" name="code" label="Código de verificación" type="text" value={code}
          autoComplete="one-time-code" inputMode="numeric" maxLength={6}
          onChange={(value) => { setCode(value.replace(/\D/g, "").slice(0, 6)); setFeedback(null); }}
          onBlur={() => {}} required />
        <p className={styles.localOnly} aria-live="polite">
          {secondsLeft > 0 ? `Vence en ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "El código venció; pide uno nuevo."}
        </p>
        {feedback && <div className={styles.feedback} data-kind={feedback.kind} role={feedback.kind === "error" ? "alert" : "status"}><InfoIcon /><p>{feedback.message}</p></div>}
        <button className={styles.primaryButton} type="submit" disabled={pending || code.length !== 6 || secondsLeft === 0}>
          {pending ? "Verificando…" : "Verificar y entrar"}
        </button>
        <button className={styles.secondaryButton} type="button" onClick={() => void resendCode()} disabled={pending || resendIn > 0}>
          {resendIn > 0 ? `Reenviar código en ${resendIn} s` : "Reenviar código"}
        </button>
        <button className={styles.secondaryButton} type="button" onClick={() => { setChallenge(null); setFeedback(null); }}>
          Usar otra cuenta
        </button>
      </form>}

      <form className={styles.form} onSubmit={submit} noValidate hidden={passwordChangeRequired || challenge !== null}>
        <Field
          id={SIGN_IN_IDS.email}
          name="email"
          label="Correo corporativo"
          type="email"
          value={input.email}
          error={errors.email}
          autoComplete="email"
          onChange={(value) => update("email", value)}
          onBlur={() => validateField("email")}
          required
        />

        <PasswordField
          id={SIGN_IN_IDS.password}
          name="password"
          label="Contraseña"
          value={input.password}
          error={errors.password}
          autoComplete="current-password"
          visible={showPassword}
          onVisibilityChange={() => setShowPassword((current) => !current)}
          onChange={(value) => update("password", value)}
          onBlur={() => validateField("password")}
        />

        <div className={styles.formOptions}>
          <span className={styles.localOnly}>Sesión temporal en esta pestaña</span>
          <Link href="/recuperar">¿Olvidaste tu contraseña?</Link>
        </div>

        {feedback && !challenge && (
          <div
            className={styles.feedback}
            data-kind={feedback.kind}
            role={feedback.kind === "error" ? "alert" : "status"}
            aria-live={feedback.kind === "error" ? "assertive" : "polite"}
          >
            <InfoIcon />
            <p>{feedback.message}</p>
          </div>
        )}

        <button className={styles.primaryButton} type="submit" disabled={pending}>
          {pending ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              Verificando…
            </>
          ) : (
            <>
              Iniciar sesión
              <ArrowRightIcon />
            </>
          )}
        </button>

      </form>

      {passwordChangeRequired && <form className={styles.form} onSubmit={submitPasswordChange} noValidate>
        <p>La API solicita reemplazar la contraseña temporal de {input.email}.</p>
        <PasswordField id="airline-new-password" name="newPassword" label="Nueva contraseña"
          value={newPassword} autoComplete="new-password" visible={showNewPassword} onVisibilityChange={() => setShowNewPassword((value) => !value)}
          onChange={setNewPassword} onBlur={() => {}} />
        <PasswordField id="airline-confirm-password" name="confirmPassword" label="Confirmar nueva contraseña"
          value={confirmPassword} autoComplete="new-password" visible={showConfirmPassword} onVisibilityChange={() => setShowConfirmPassword((value) => !value)}
          onChange={setConfirmPassword} onBlur={() => {}} />
        {feedback && <div className={styles.feedback} data-kind={feedback.kind} role="alert"><InfoIcon /><p>{feedback.message}</p></div>}
        <button className={styles.primaryButton} type="submit" disabled={pending}>Cambiar contraseña</button>
      </form>}

      <p className={styles.requestLink}>¿No tienes credenciales? <Link href="/solicitar-acceso">Solicita acceso aquí</Link></p>

      <p className={styles.formDisclaimer}>
        La sesión se revalida al recargar y termina al cerrar sesión o vencer el token.
      </p>
    </div>
  );
}

type FieldProps = {
  id: string;
  name: string;
  label: string;
  value: string;
  error?: string;
  type?: "text" | "email" | "tel";
  autoComplete: string;
  hint?: string;
  maxLength?: number;
  inputMode?: "numeric" | "text" | "email";
  required?: boolean;
  wide?: boolean;
  code?: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
};

function Field({
  id,
  name,
  label,
  value,
  error,
  type = "text",
  autoComplete,
  hint,
  maxLength,
  inputMode,
  required,
  wide,
  code,
  onChange,
  onBlur,
}: FieldProps) {
  const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={styles.field} data-wide={wide} data-code={code}>
      <div className={styles.labelRow}>
        <label htmlFor={id}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
        {hint && !error && <span id={`${id}-hint`}>{hint}</span>}
      </div>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        maxLength={maxLength}
        inputMode={inputMode}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={descriptionId}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={onBlur}
      />
      {error && (
        <p className={styles.error} id={`${id}-error`} aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

type PasswordFieldProps = Omit<FieldProps, "type" | "wide" | "code"> & {
  visible: boolean;
  onVisibilityChange: () => void;
};

function PasswordField({
  visible,
  onVisibilityChange,
  id,
  name,
  label,
  value,
  error,
  autoComplete,
  hint,
  onChange,
  onBlur,
}: PasswordFieldProps) {
  const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={id}>
          {label} <span aria-hidden="true">*</span>
        </label>
        {hint && !error && <span id={`${id}-hint`}>{hint}</span>}
      </div>
      <div className={styles.passwordControl}>
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          aria-label={label}
          value={value}
          autoComplete={autoComplete}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={descriptionId}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={onBlur}
        />
        <button
          type="button"
          aria-label={visible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={onVisibilityChange}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {error && (
        <p className={styles.error} id={`${id}-error`} aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <div>
        <strong>Preparando acceso local</strong>
        <p>Comprobando si existe una sesión en este navegador.</p>
      </div>
    </div>
  );
}

function withoutKey<Key extends PropertyKey, Value>(
  object: Partial<Record<Key, Value>>,
  key: Key,
) {
  if (!(key in object)) return object;
  const next = { ...object };
  delete next[key];
  return next;
}

function focusField<Key extends PropertyKey>(
  ids: Record<Key, string>,
  field: Key,
) {
  requestAnimationFrame(() => document.getElementById(ids[field])?.focus());
}

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M16 10H5m4 5-5-5 5-5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11m-4-5 5 5-5 5" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3 3 18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6.1 0 9.5 6 9.5 6a14.8 14.8 0 0 1-2.4 3.1M6.1 6.2A15.5 15.5 0 0 0 2.5 12s3.4 6 9.5 6c1.2 0 2.3-.2 3.3-.6M10.1 10.1a2.7 2.7 0 0 0 3.8 3.8" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v4.5M10 6.5h.01" />
    </svg>
  );
}

function PlaneIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M5 27.5 21 24 16 8l4-2 9 15 10-2.2c2.8-.6 4.5.4 5 2.2.5 1.8-.5 3.5-3 4.6L30 30l-6 13-3.6 1 1.4-12.5L8 33l-3-5.5Z" />
    </svg>
  );
}
