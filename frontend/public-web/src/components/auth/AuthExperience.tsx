"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useState,
} from "react";

import { BrandMark } from "@/components/marketing/BrandMark";
import { environmentLabel } from "@/lib/environment-label";
import {
  type MockSignInField,
  type MockSignInInput,
  validateSignIn,
} from "@/lib/mock-auth";
import { meetsPasswordPolicy, PASSWORD_ERRORS, passwordRequirements } from "@/lib/password-policy";
import { useAirlineSession, type AirlineLoginChallenge, type AirlineSignInFailure } from "./AirlineSessionProvider";
import { PasswordRequirements } from "./PasswordRequirements";

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
type PasswordChangeField = "newPassword" | "confirmPassword";

const SIGN_IN_IDS: Record<SignInInputField, string> = {
  email: "auth-email",
  password: "auth-password",
  remember: "auth-remember",
};

const PASSWORD_CHANGE_IDS: Record<PasswordChangeField, string> = {
  newPassword: "airline-new-password",
  confirmPassword: "airline-confirm-password",
};
const CODE_ID = "auth-code";

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

/**
 * Side panel of /login, /activar and /recuperar. It names an environment only when the deployment
 * sets NEXT_PUBLIC_ELEVANT_ENVIRONMENT_LABEL (1-N24); otherwise it shows no environment at all.
 */
export function CredentialPanel() {
  const label = environmentLabel();
  return (
    <aside className={styles.credential} aria-labelledby="auth-title">
      <div className={styles.credentialGrid} aria-hidden="true" />
      <div className={styles.routeOrbit} aria-hidden="true">
        <span />
        <span />
        <PlaneIcon />
      </div>

      <div className={styles.credentialContent}>
        <p className={styles.kicker}>{label ? `Portal de aerolíneas · ${label}` : "Portal de aerolíneas"}</p>
        <h1 id="auth-title">La operación, visible para quien debe verla.</h1>
        <p className={styles.credentialLead}>
          Consulte las operaciones de su aerolínea en las estaciones autorizadas
          para su cuenta.
        </p>

        <div className={styles.routeCard}>
          <div className={styles.routeCardTop}>
            <span>Verificación de acceso</span>
            <strong>Cuenta y código por correo</strong>
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
              <span>Código por correo</span>
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

      {label && (
        <footer className={styles.credentialFootnote}>
          Entorno: {label}
        </footer>
      )}
    </aside>
  );
}

// N19: everything the airline reads in the access addresses it as usted.
function signInFailureMessage(reason: AirlineSignInFailure): string {
  switch (reason) {
    case "invalid": return "No se pudo validar la cuenta. Revise el correo y la contraseña.";
    case "forbidden": return "Esta cuenta no tiene acceso al portal de aerolíneas.";
    case "context": return "Los datos de su aerolínea no están disponibles ahora. Reintente en unos minutos.";
    case "password-change-required": return "Debe cambiar la contraseña temporal antes de entrar.";
    case "rate-limited": return "Demasiados intentos. Espere un momento antes de reintentar.";
    case "unavailable": return "No se pudo conectar con ELEVANT. Compruebe la conexión y reintente.";
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
  const [passwordErrors, setPasswordErrors] = useState<Partial<Record<PasswordChangeField, string>>>({});
  const [passwordChecked, setPasswordChecked] = useState(false);
  const [codeResent, setCodeResent] = useState(false);

  // N17: each step of the login starts in its first field, whose description explains the step. A resent code keeps
  // its challenge, so the focus stays where the airline left it.
  const challengeId = challenge?.challengeId;
  useEffect(() => {
    if (challengeId) document.getElementById(CODE_ID)?.focus();
  }, [challengeId]);
  useEffect(() => {
    if (passwordChangeRequired) document.getElementById(PASSWORD_CHANGE_IDS.newPassword)?.focus();
  }, [passwordChangeRequired]);

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
        message: "Revise los campos indicados para continuar.",
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
      // The instruction of the code step says what was asked for (1-N08); no message repeats it.
      setChallenge(result.challenge);
      setCode("");
      setCodeResent(false);
      setResendAvailableAt(Date.now() + 30_000);
    } else if (result.reason === "password-change-required") {
      // N17: replacing the temporary password is the next step of the login, not an error.
      setNewPassword("");
      setConfirmPassword("");
      setPasswordErrors({});
      setPasswordChecked(false);
      setPasswordChangeRequired(true);
    } else {
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
      ? "El código no es válido o ya venció. Revise el último correo o pida uno nuevo."
      : signInFailureMessage(result.reason as AirlineSignInFailure) });
  };

  const resendCode = async () => {
    if (!challenge) return;
    setPending(true);
    const next = await resendLoginCode(challenge.challengeId);
    setPending(false);
    if (!next) {
      setChallenge(null);
      setFeedback({ kind: "error", message: "El código venció o se bloqueó. Inicie sesión de nuevo." });
      return;
    }
    setChallenge(next);
    setCode("");
    setCodeResent(true);
    setResendAvailableAt(Date.now() + 30_000);
    setFeedback(null);
  };

  const secondsLeft = challenge ? Math.max(0, Math.ceil((Date.parse(challenge.expiresAt) - now) / 1000)) : 0;
  const resendIn = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));

  const changePasswordField = (field: PasswordChangeField, value: string) => {
    if (field === "newPassword") setNewPassword(value);
    else setConfirmPassword(value);
    setPasswordErrors((current) => withoutKey(current, field));
  };

  const submitPasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    // N17: the API would refuse it (its policy, or the temporary password itself), so it is not sent.
    if (!meetsPasswordPolicy(newPassword, input.password)) {
      setPasswordChecked(true);
      setPasswordErrors({ newPassword: PASSWORD_ERRORS.requirements });
      focusField(PASSWORD_CHANGE_IDS, "newPassword");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordErrors({ confirmPassword: PASSWORD_ERRORS.confirmation });
      focusField(PASSWORD_CHANGE_IDS, "confirmPassword");
      return;
    }
    setPasswordErrors({});
    setPending(true);
    const result = await changePassword({ email: input.email.trim(), currentPassword: input.password, newPassword });
    setPending(false);
    if (!result.ok) {
      const message = result.reason === "invalid" ? "La contraseña actual no es válida."
        : result.reason === "policy" ? "La nueva contraseña no cumple la política de seguridad. Revise los requisitos de la lista."
          : result.reason === "rate-limited" ? "Demasiados intentos. Espere antes de reintentar."
            : "No se pudo cambiar la contraseña. Reintente en unos minutos.";
      setFeedback({ kind: "error", message });
      return;
    }
    setInput(INITIAL_SIGN_IN);
    setNewPassword("");
    setConfirmPassword("");
    setPasswordChangeRequired(false);
    setFeedback({ kind: "info", message: "Contraseña actualizada. Inicie sesión con su nueva contraseña." });
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
        <h2 id="login-heading">Continúe al portal de su aerolínea.</h2>
        <p>
          Utilice la cuenta emitida para su aerolínea. Al entrar comprobamos su
          acceso y las estaciones autorizadas para su cuenta.
        </p>
      </header>

      {challenge && <form className={styles.form} onSubmit={submitCode} noValidate aria-labelledby="code-heading">
        <div className={styles.stepHeader}>
          <h3 id="code-heading">Código de verificación por correo</h3>
          {/* 1-N08: the code was only queued, so the one instruction of the step never says it was sent. */}
          <p id="code-instruction" aria-live="polite" aria-atomic="true">
            {codeResent ? "Pedimos un código nuevo para " : "Pedimos un código de 6 dígitos para "}
            <strong>{challenge.emailHint}</strong>
            {codeResent ? ". El anterior ya no sirve." : "."}
            {" Puede tardar unos minutos en llegar; revise también la carpeta de spam."}
          </p>
        </div>
        <Field id={CODE_ID} name="code" label="Código de verificación" type="text" value={code}
          autoComplete="one-time-code" inputMode="numeric" maxLength={6} describedBy="code-instruction"
          onChange={(value) => { setCode(value.replace(/\D/g, "").slice(0, 6)); setFeedback(null); }}
          onBlur={() => {}} required />
        <p className={styles.localOnly} aria-live="polite">
          {secondsLeft > 0 ? `Vence en ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "El código venció; pida uno nuevo."}
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
          <Link href="/recuperar">¿Olvidó su contraseña?</Link>
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

      {passwordChangeRequired && <form className={styles.form} onSubmit={submitPasswordChange} noValidate
        aria-labelledby="password-change-heading">
        <div className={styles.stepHeader}>
          <h3 id="password-change-heading">Cambio de la contraseña temporal</h3>
          <p id="password-change-explanation">
            La contraseña de <strong>{input.email.trim()}</strong> es temporal. Elija una nueva para reemplazarla;
            después inicie sesión con ella.
          </p>
        </div>
        <PasswordField id={PASSWORD_CHANGE_IDS.newPassword} name="newPassword" label="Nueva contraseña"
          value={newPassword} error={passwordErrors.newPassword} autoComplete="new-password"
          describedBy={`password-change-explanation ${PASSWORD_CHANGE_IDS.newPassword}-requirements`}
          visible={showNewPassword} onVisibilityChange={() => setShowNewPassword((value) => !value)}
          onChange={(value) => changePasswordField("newPassword", value)} onBlur={() => {}} />
        <PasswordRequirements id={`${PASSWORD_CHANGE_IDS.newPassword}-requirements`}
          requirements={passwordRequirements(newPassword, input.password)} checked={passwordChecked} />
        <PasswordField id={PASSWORD_CHANGE_IDS.confirmPassword} name="confirmPassword" label="Confirmar nueva contraseña"
          value={confirmPassword} error={passwordErrors.confirmPassword} autoComplete="new-password"
          visible={showConfirmPassword} onVisibilityChange={() => setShowConfirmPassword((value) => !value)}
          onChange={(value) => changePasswordField("confirmPassword", value)} onBlur={() => {}} />
        {feedback && <div className={styles.feedback} data-kind={feedback.kind} role="alert"><InfoIcon /><p>{feedback.message}</p></div>}
        <button className={styles.primaryButton} type="submit" disabled={pending}>Cambiar contraseña</button>
      </form>}

      <p className={styles.requestLink}>¿No tiene credenciales? <Link href="/solicitar-acceso">Solicite acceso aquí</Link></p>

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
  /** Other elements that describe the field, after its error or hint: an instruction, a list of requirements. */
  describedBy?: string;
  maxLength?: number;
  inputMode?: "numeric" | "text" | "email";
  required?: boolean;
  wide?: boolean;
  code?: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
};

/** The ids the field's aria-describedby names: its error (or else its hint), then the other descriptions. */
function descriptionIds(id: string, error?: string, hint?: string, describedBy?: string) {
  const own = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return [own, describedBy].filter(Boolean).join(" ") || undefined;
}

function Field({
  id,
  name,
  label,
  value,
  error,
  type = "text",
  autoComplete,
  hint,
  describedBy,
  maxLength,
  inputMode,
  required,
  wide,
  code,
  onChange,
  onBlur,
}: FieldProps) {
  const descriptionId = descriptionIds(id, error, hint, describedBy);

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
  describedBy,
  onChange,
  onBlur,
}: PasswordFieldProps) {
  const descriptionId = descriptionIds(id, error, hint, describedBy);

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
