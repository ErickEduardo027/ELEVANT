"use client";

import { FormEvent, useState } from "react";

import {
  EMPTY_DEMO_REQUEST_DRAFT,
  resolveDemoRequest,
  type DemoRequestDraft,
  type DemoRequestErrors,
  type DemoRequestField,
} from "@/lib/demo-request";

const FIELD_IDS: Record<DemoRequestField, string> = {
  nombre: "demo-nombre",
  aerolinea: "demo-aerolinea",
  cargo: "demo-cargo",
  correoCorporativo: "demo-correo",
  estacionPais: "demo-estacion",
  necesidadOperativa: "demo-necesidad",
};

export function DemoRequestForm() {
  const [draft, setDraft] = useState<DemoRequestDraft>({
    ...EMPTY_DEMO_REQUEST_DRAFT,
  });
  const [errors, setErrors] = useState<DemoRequestErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"notice" | "error">("notice");

  const updateField = (field: DemoRequestField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setMessage(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = resolveDemoRequest(draft);

    if (result.status === "invalid") {
      setErrors(result.errors);
      setMessage(result.message);
      setMessageKind("error");
      requestAnimationFrame(() => {
        document.getElementById(FIELD_IDS[result.firstInvalidField])?.focus();
      });
      return;
    }

    setDraft(result.value);
    setErrors({});
    setMessage(result.message);
    setMessageKind("notice");
  };

  return (
    <form className="demo-form" onSubmit={submit} noValidate>
      <div className="demo-form__heading">
        <span className="demo-form__index" aria-hidden="true">
          01—06
        </span>
        <p>
          Todos los campos son obligatorios. Los datos permanecen localmente en
          esta página.
        </p>
      </div>

      <div className="form-grid">
        <FormField
          field="nombre"
          label="Nombre"
          value={draft.nombre}
          error={errors.nombre}
          autoComplete="name"
          onChange={updateField}
        />
        <FormField
          field="aerolinea"
          label="Aerolínea"
          value={draft.aerolinea}
          error={errors.aerolinea}
          autoComplete="organization"
          onChange={updateField}
        />
        <FormField
          field="cargo"
          label="Cargo"
          value={draft.cargo}
          error={errors.cargo}
          autoComplete="organization-title"
          onChange={updateField}
        />
        <FormField
          field="correoCorporativo"
          label="Correo corporativo"
          type="email"
          value={draft.correoCorporativo}
          error={errors.correoCorporativo}
          autoComplete="email"
          onChange={updateField}
        />
        <FormField
          field="estacionPais"
          label="Estación / país"
          value={draft.estacionPais}
          error={errors.estacionPais}
          autoComplete="country-name"
          onChange={updateField}
        />
        <div className="form-field form-field--wide">
          <label htmlFor={FIELD_IDS.necesidadOperativa}>
            Necesidad operativa <span aria-hidden="true">*</span>
          </label>
          <textarea
            id={FIELD_IDS.necesidadOperativa}
            name="necesidadOperativa"
            value={draft.necesidadOperativa}
            onChange={(event) =>
              updateField("necesidadOperativa", event.currentTarget.value)
            }
            aria-invalid={Boolean(errors.necesidadOperativa)}
            aria-describedby={
              errors.necesidadOperativa ? "demo-necesidad-error" : undefined
            }
            maxLength={1000}
            rows={4}
            required
          />
          {errors.necesidadOperativa && (
            <span className="field-error" id="demo-necesidad-error" role="alert">
              {errors.necesidadOperativa}
            </span>
          )}
        </div>
      </div>

      <div className="demo-form__footer">
        <button className="button button--form" type="submit">
          Preparar solicitud
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 10h11M11 5l5 5-5 5" />
          </svg>
        </button>
        <p className="form-privacy">
          Este prototipo no envía, guarda ni comparte la información ingresada.
        </p>
      </div>

      {message && (
        <div
          className="form-message"
          data-kind={messageKind}
          role={messageKind === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span aria-hidden="true" />
          <p>{message}</p>
        </div>
      )}
    </form>
  );
}

type FormFieldProps = {
  field: Exclude<DemoRequestField, "necesidadOperativa">;
  label: string;
  value: string;
  error?: string;
  type?: "text" | "email";
  autoComplete: string;
  onChange: (field: DemoRequestField, value: string) => void;
};

function FormField({
  field,
  label,
  value,
  error,
  type = "text",
  autoComplete,
  onChange,
}: FormFieldProps) {
  const errorId = `${FIELD_IDS[field]}-error`;

  return (
    <div className="form-field">
      <label htmlFor={FIELD_IDS[field]}>
        {label} <span aria-hidden="true">*</span>
      </label>
      <input
        id={FIELD_IDS[field]}
        name={field}
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(event) => onChange(field, event.currentTarget.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        maxLength={field === "correoCorporativo" ? 254 : 120}
        required
      />
      {error && (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
