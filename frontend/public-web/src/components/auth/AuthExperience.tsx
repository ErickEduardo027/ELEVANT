"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { BrandMark } from "@/components/marketing/BrandMark";
import {
  type MockSignInField,
  type MockSignInInput,
  validateSignIn,
} from "@/lib/mock-auth";
import {
  type MockAffiliationInput,
  type MockAffiliationRequest,
  validateAffiliation,
} from "@/lib/mock-affiliation";

import { useAirlineSession, type AirlineSignInResult } from "./AirlineSessionProvider";
import { useMockSession } from "./MockSessionProvider";

import styles from "./AuthExperience.module.css";

export type AuthMode = "login" | "register";

type AuthExperienceProps = {
  initialMode?: AuthMode;
  returnTo?: string;
};

type SignInInputField = keyof MockSignInInput;
type SignInField = MockSignInField;
type RegistrationField = keyof MockAffiliationInput;
type SignInErrors = Partial<Record<SignInField, string>>;
type RegistrationErrors = Partial<Record<RegistrationField, string>>;
type SignInFeedback = {
  message: string;
  kind: "info" | "error";
};

const SIGN_IN_IDS: Record<SignInInputField, string> = {
  email: "auth-email",
  password: "auth-password",
  remember: "auth-remember",
};

const REGISTRATION_IDS: Record<RegistrationField, string> = {
  legalName: "register-legal-name",
  displayName: "register-display-name",
  iataCode: "register-iata-code",
  icaoCode: "register-icao-code",
  country: "register-country",
  primaryStation: "register-primary-station",
  additionalStations: "register-additional-stations",
  fullName: "register-full-name",
  title: "register-title",
  email: "register-email",
  phone: "register-phone",
  servicesOfInterest: "register-services",
  prototypeAcknowledged: "register-prototype-acknowledged",
};

const STEP_ONE_FIELDS: readonly RegistrationField[] = [
  "legalName",
  "displayName",
  "iataCode",
  "icaoCode",
  "country",
  "primaryStation",
  "additionalStations",
];

const INITIAL_SIGN_IN: MockSignInInput = {
  email: "",
  password: "",
  remember: false,
};

const INITIAL_REGISTRATION: MockAffiliationInput = {
  legalName: "",
  displayName: "",
  iataCode: "",
  icaoCode: "",
  country: "",
  primaryStation: "",
  additionalStations: "",
  fullName: "",
  title: "",
  email: "",
  phone: "",
  servicesOfInterest: "",
  prototypeAcknowledged: false,
};

export function AuthExperience({
  initialMode = "login",
  returnTo = "/portal",
}: AuthExperienceProps) {
  const router = useRouter();
  const { status } = useAirlineSession();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const loginTabRef = useRef<HTMLButtonElement>(null);
  const registerTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (status === "ready") router.replace(returnTo);
  }, [returnTo, router, status]);

  const selectMode = (nextMode: AuthMode, focusTab = false) => {
    setMode(nextMode);
    const parameters = new URLSearchParams({ mode: nextMode });
    if (returnTo !== "/portal") parameters.set("returnTo", returnTo);
    router.replace(`/login?${parameters.toString()}`, { scroll: false });

    if (focusTab) {
      requestAnimationFrame(() => {
        (nextMode === "login" ? loginTabRef : registerTabRef).current?.focus();
      });
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const nextMode =
      event.key === "ArrowLeft" || event.key === "Home" ? "login" : "register";
    selectMode(nextMode, true);
  };

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
                <div
                  className={styles.tabs}
                  role="tablist"
                  aria-label="Elegir tipo de acceso"
                  onKeyDown={handleTabKeyDown}
                >
                  <button
                    ref={loginTabRef}
                    id="login-tab"
                    type="button"
                    role="tab"
                    aria-selected={mode === "login"}
                    aria-controls="login-panel"
                    tabIndex={mode === "login" ? 0 : -1}
                    onClick={() => selectMode("login")}
                  >
                    Iniciar sesión
                  </button>
                  <button
                    ref={registerTabRef}
                    id="register-tab"
                    type="button"
                    role="tab"
                    aria-selected={mode === "register"}
                    aria-controls="register-panel"
                    tabIndex={mode === "register" ? 0 : -1}
                    onClick={() => selectMode("register")}
                  >
                    Solicitar afiliación
                  </button>
                </div>

                {mode === "login" ? (
                  <SignInPanel returnTo={returnTo} />
                ) : (
                  <AffiliationPanel />
                )}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function CredentialPanel() {
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
            <span>Credencial de ruta</span>
            <strong>EV / AIRLINE</strong>
          </div>
          <div className={styles.routeCodes}>
            <div>
              <strong>MIA</strong>
              <span>Origen demo</span>
            </div>
            <div className={styles.routeLine} aria-hidden="true">
              <i />
              <PlaneIcon />
              <i />
            </div>
            <div>
              <strong>PUJ</strong>
              <span>Estación piloto</span>
            </div>
          </div>
          <div className={styles.routeCardBottom}>
            <span>Estado</span>
            <strong>
              <i aria-hidden="true" /> Acceso autenticado
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

function signInFailureMessage(reason: Exclude<AirlineSignInResult, { ok: true }>["reason"]): string {
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
  const { signIn, changePassword } = useAirlineSession();
  const [input, setInput] = useState<MockSignInInput>(INITIAL_SIGN_IN);
  const [errors, setErrors] = useState<SignInErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<SignInFeedback | null>(null);
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);

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
    } else {
      if (result.reason === "password-change-required") setPasswordChangeRequired(true);
      setFeedback({ kind: "error", message: signInFailureMessage(result.reason) });
    }
  };

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
      role="tabpanel"
      aria-labelledby="login-tab"
      tabIndex={0}
    >
      <header className={styles.formHeader}>
        <p className={styles.formKicker}>Acceso autorizado</p>
        <h2>Continúa al portal de tu aerolínea.</h2>
        <p>
          Utiliza la cuenta emitida para tu aerolínea. El acceso y las estaciones
          se comprueban con la API de Development.
        </p>
      </header>

      <form className={styles.form} onSubmit={submit} noValidate hidden={passwordChangeRequired}>
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
        </div>

        {feedback && (
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
          value={confirmPassword} autoComplete="new-password" visible={showNewPassword} onVisibilityChange={() => setShowNewPassword((value) => !value)}
          onChange={setConfirmPassword} onBlur={() => {}} />
        {feedback && <div className={styles.feedback} data-kind={feedback.kind} role="alert"><InfoIcon /><p>{feedback.message}</p></div>}
        <button className={styles.primaryButton} type="submit" disabled={pending}>Cambiar contraseña</button>
      </form>}

      <p className={styles.formDisclaimer}>
        La sesión se revalida al recargar y termina al cerrar sesión o vencer el token.
      </p>
    </div>
  );
}

function AffiliationPanel() {
  const { requestAffiliation } = useMockSession();
  const [input, setInput] = useState<MockAffiliationInput>(INITIAL_REGISTRATION);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [step, setStep] = useState<1 | 2>(1);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<MockAffiliationRequest | null>(null);

  const update = <Field extends RegistrationField>(
    field: Field,
    value: MockAffiliationInput[Field],
  ) => {
    setInput((current) => ({ ...current, [field]: value }));
    setErrors((current) => withoutKey(current, field));
    setFeedback(null);
  };

  const validateField = (field: RegistrationField) => {
    const result = validateAffiliation(input);
    if (result.ok || !result.fieldErrors[field]) {
      setErrors((current) => withoutKey(current, field));
      return;
    }
    setErrors((current) => ({ ...current, [field]: result.fieldErrors[field] }));
  };

  const continueToContact = () => {
    const validation = validateAffiliation(input);
    if (!validation.ok) {
      const stepErrors = pickErrors(validation.fieldErrors, STEP_ONE_FIELDS);
      const firstInvalid = STEP_ONE_FIELDS.find((field) => stepErrors[field]);
      if (firstInvalid) {
        setErrors((current) => ({ ...current, ...stepErrors }));
        focusField(REGISTRATION_IDS, firstInvalid);
        return;
      }
    }

    setStep(2);
    requestAnimationFrame(() =>
      document.getElementById(REGISTRATION_IDS.fullName)?.focus(),
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    const validation = validateAffiliation(input);

    if (!validation.ok) {
      setErrors(validation.fieldErrors);
      setFeedback("Revisa los campos indicados para enviar la solicitud.");
      const firstField = validation.firstInvalidField;
      if (STEP_ONE_FIELDS.includes(firstField)) setStep(1);
      requestAnimationFrame(() => focusField(REGISTRATION_IDS, firstField));
      return;
    }

    setPending(true);
    const result = await requestAffiliation(validation.value);
    setPending(false);

    if (result.ok) {
      setSubmitted(result.request);
    } else {
      setFeedback(result.message);
      if (result.fieldErrors) setErrors(result.fieldErrors);
      if (result.firstInvalidField) {
        const firstInvalidField = result.firstInvalidField;
        if (STEP_ONE_FIELDS.includes(firstInvalidField)) setStep(1);
        requestAnimationFrame(() =>
          focusField(REGISTRATION_IDS, firstInvalidField),
        );
      }
    }
  };

  if (submitted) {
    return (
      <div
        className={`${styles.tabPanel} ${styles.session}`}
        id="register-panel"
        role="tabpanel"
        aria-labelledby="register-tab"
        tabIndex={0}
      >
        <div className={styles.sessionStatus} role="status" aria-live="polite">
          <span aria-hidden="true" />
          Solicitud recibida
        </div>
        <p className={styles.formKicker}>Afiliación en evaluación</p>
        <h2>Tu solicitud quedó registrada.</h2>
        <p className={styles.sessionLead}>
          Conserva la referencia <strong>{submitted.reference}</strong>. En esta
          demo el seguimiento permanece únicamente en este navegador.
        </p>
        <dl className={styles.sessionCard}>
          <div className={styles.sessionIdentity}>
            <dt>Aerolínea</dt>
            <dd>{submitted.airline.displayName}</dd>
            <span>
              {submitted.airline.iataCode ?? submitted.airline.icaoCode ?? "—"}
            </span>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>Recibida</dd>
            <span>{submitted.stations.primary} · estación principal</span>
          </div>
        </dl>
        <div className={styles.sessionNotice}>
          <InfoIcon />
          <p>
            La solicitud no crea una cuenta ni habilita acceso al portal. AVIAM
            deberá validar la afiliación y emitir credenciales por un canal seguro.
          </p>
        </div>
        <div className={styles.sessionActions}>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => {
              setSubmitted(null);
              setInput(INITIAL_REGISTRATION);
              setErrors({});
              setStep(1);
            }}
          >
            Nueva solicitud
          </button>
          <Link className={styles.secondaryLink} href="/login?mode=login">
            Ir al inicio de sesión
            <ArrowRightIcon />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.tabPanel}
      id="register-panel"
      role="tabpanel"
      aria-labelledby="register-tab"
      tabIndex={0}
    >
      <header className={styles.formHeader}>
        <p className={styles.formKicker}>Solicitud para evaluación</p>
        <h2>Solicita la afiliación de tu aerolínea.</h2>
        <p>
          Registra la operación que deseas consultar. La solicitud no crea una
          cuenta ni concede acceso automático.
        </p>
      </header>

      <div className={styles.stepper} aria-label={`Paso ${step} de 2`}>
        <div data-active={step === 1} data-complete={step === 2}>
          <span>{step === 2 ? <CheckIcon /> : "01"}</span>
          <p>
            <strong>Aerolínea</strong>
            <small>Identidad y estaciones</small>
          </p>
        </div>
        <i aria-hidden="true" />
        <div data-active={step === 2}>
          <span>02</span>
          <p>
            <strong>Representante</strong>
            <small>Contacto y necesidades</small>
          </p>
        </div>
      </div>

      <form className={styles.form} onSubmit={submit} noValidate>
        {step === 1 ? (
          <fieldset className={styles.fieldset}>
            <legend className={styles.srOnly}>Información de la aerolínea</legend>
            <div className={styles.fieldGrid}>
              <Field
                id={REGISTRATION_IDS.legalName}
                name="legalName"
                label="Razón social"
                value={input.legalName}
                error={errors.legalName}
                autoComplete="organization"
                onChange={(value) => update("legalName", value)}
                onBlur={() => validateField("legalName")}
                required
                wide
              />
              <Field
                id={REGISTRATION_IDS.displayName}
                name="displayName"
                label="Nombre comercial"
                value={input.displayName}
                error={errors.displayName}
                autoComplete="organization"
                onChange={(value) => update("displayName", value)}
                onBlur={() => validateField("displayName")}
                hint="Opcional"
                wide
              />
              <Field
                id={REGISTRATION_IDS.iataCode}
                name="iataCode"
                label="Código IATA"
                value={input.iataCode}
                error={errors.iataCode}
                autoComplete="off"
                onChange={(value) => update("iataCode", value.toUpperCase())}
                onBlur={() => validateField("iataCode")}
                hint="IATA o ICAO requerido"
                maxLength={2}
                code
              />
              <Field
                id={REGISTRATION_IDS.icaoCode}
                name="icaoCode"
                label="Código ICAO"
                value={input.icaoCode}
                error={errors.icaoCode}
                autoComplete="off"
                onChange={(value) => update("icaoCode", value.toUpperCase())}
                onBlur={() => validateField("icaoCode")}
                hint="IATA o ICAO requerido"
                maxLength={3}
                code
              />
              <Field
                id={REGISTRATION_IDS.country}
                name="country"
                label="País"
                value={input.country}
                error={errors.country}
                autoComplete="country-name"
                onChange={(value) => update("country", value)}
                onBlur={() => validateField("country")}
                required
              />
              <Field
                id={REGISTRATION_IDS.primaryStation}
                name="primaryStation"
                label="Estación principal"
                value={input.primaryStation}
                error={errors.primaryStation}
                autoComplete="off"
                onChange={(value) => update("primaryStation", value.toUpperCase())}
                onBlur={() => validateField("primaryStation")}
                hint="Ej.: PUJ"
                maxLength={4}
                required
                code
              />
              <Field
                id={REGISTRATION_IDS.additionalStations}
                name="additionalStations"
                label="Estaciones adicionales"
                value={input.additionalStations}
                error={errors.additionalStations}
                autoComplete="off"
                onChange={(value) => update("additionalStations", value.toUpperCase())}
                onBlur={() => validateField("additionalStations")}
                hint="Opcional · separadas por coma, ej.: SDQ, STI"
                wide
              />
            </div>

            <button
              className={styles.primaryButton}
              type="button"
              onClick={continueToContact}
            >
              Continuar con el representante
              <ArrowRightIcon />
            </button>
          </fieldset>
        ) : (
          <fieldset className={styles.fieldset}>
            <legend className={styles.srOnly}>Representante y servicios</legend>
            <div className={styles.fieldGrid}>
              <Field
                id={REGISTRATION_IDS.fullName}
                name="fullName"
                label="Nombre completo"
                value={input.fullName}
                error={errors.fullName}
                autoComplete="name"
                onChange={(value) => update("fullName", value)}
                onBlur={() => validateField("fullName")}
                required
              />
              <Field
                id={REGISTRATION_IDS.title}
                name="title"
                label="Cargo"
                value={input.title}
                error={errors.title}
                autoComplete="organization-title"
                onChange={(value) => update("title", value)}
                onBlur={() => validateField("title")}
                required
              />
              <Field
                id={REGISTRATION_IDS.email}
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
              <Field
                id={REGISTRATION_IDS.phone}
                name="phone"
                label="Teléfono"
                type="tel"
                value={input.phone}
                error={errors.phone}
                autoComplete="tel"
                onChange={(value) => update("phone", value)}
                onBlur={() => validateField("phone")}
                required
              />
              <TextAreaField
                id={REGISTRATION_IDS.servicesOfInterest}
                name="servicesOfInterest"
                label="Servicios de interés"
                value={input.servicesOfInterest}
                error={errors.servicesOfInterest}
                onChange={(value) => update("servicesOfInterest", value)}
                onBlur={() => validateField("servicesOfInterest")}
              />
            </div>

            <div className={styles.acknowledgement}>
              <label
                className={styles.checkbox}
                htmlFor={REGISTRATION_IDS.prototypeAcknowledged}
              >
                <input
                  id={REGISTRATION_IDS.prototypeAcknowledged}
                  name="prototypeAcknowledged"
                  type="checkbox"
                  checked={input.prototypeAcknowledged}
                  onChange={(event) =>
                    update("prototypeAcknowledged", event.currentTarget.checked)
                  }
                  onBlur={() => validateField("prototypeAcknowledged")}
                  aria-invalid={Boolean(errors.prototypeAcknowledged)}
                  aria-describedby={
                    errors.prototypeAcknowledged
                      ? `${REGISTRATION_IDS.prototypeAcknowledged}-error`
                      : undefined
                  }
                />
                <span aria-hidden="true">
                  <CheckIcon />
                </span>
                Entiendo que esta solicitud será enviada al Departamento de
                Contratos y no crea credenciales de acceso automáticamente.
              </label>
              {errors.prototypeAcknowledged && (
                <p
                  className={styles.error}
                  id={`${REGISTRATION_IDS.prototypeAcknowledged}-error`}
                  aria-live="polite"
                >
                  {errors.prototypeAcknowledged}
                </p>
              )}
            </div>

            {feedback && (
              <div className={styles.feedback} data-kind="error" role="alert">
                <InfoIcon />
                <p>{feedback}</p>
              </div>
            )}

            <div className={styles.stepActions}>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => setStep(1)}
                disabled={pending}
              >
                <ArrowLeftIcon />
                Volver a la aerolínea
              </button>
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={pending}
              >
                {pending ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" />
                    Guardando solicitud…
                  </>
                ) : (
                  <>
                    Enviar solicitud de afiliación
                    <ArrowRightIcon />
                  </>
                )}
              </button>
            </div>
          </fieldset>
        )}
      </form>
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

type TextAreaFieldProps = {
  id: string;
  name: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  onBlur: () => void;
};

function TextAreaField({
  id,
  name,
  label,
  value,
  error,
  onChange,
  onBlur,
}: TextAreaFieldProps) {
  return (
    <div className={styles.field} data-wide="true">
      <div className={styles.labelRow}>
        <label htmlFor={id}>
          {label} <span aria-hidden="true">*</span>
        </label>
        {!error && <span id={`${id}-hint`}>Máximo 800 caracteres</span>}
      </div>
      <textarea
        id={id}
        name={name}
        value={value}
        maxLength={800}
        rows={4}
        required
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
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

function pickErrors<Key extends PropertyKey>(
  errors: Partial<Record<Key, string>>,
  fields: readonly Key[],
) {
  return fields.reduce<Partial<Record<Key, string>>>((selected, field) => {
    if (errors[field]) selected[field] = errors[field];
    return selected;
  }, {});
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m4.5 10.5 3.3 3.3 7.7-8" />
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

function InfoIcon() {
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
