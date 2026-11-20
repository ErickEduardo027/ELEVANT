import { PASSWORD_REQUIREMENTS_NOTE, type PasswordRequirement } from "@/lib/password-policy";

import styles from "./AuthExperience.module.css";

/**
 * N17: the requirements of a new password, on screen before anything is typed. Each item says with `data-met` (and in
 * words, for screen readers) whether it is met; once a submit was refused, `checked` paints the missing ones as errors.
 * The password field names this block in its aria-describedby, so the list is read with the field.
 */
export function PasswordRequirements({ id, requirements, checked }: {
  id: string;
  requirements: readonly PasswordRequirement[];
  checked: boolean;
}) {
  return (
    <div className={styles.requirements} id={id} data-checked={checked}>
      <p id={`${id}-title`}>Requisitos de la contraseña</p>
      <ul aria-labelledby={`${id}-title`} aria-live="polite">
        {requirements.map((requirement) => (
          <li key={requirement.id} data-requirement={requirement.id} data-met={requirement.met}>
            <span aria-hidden="true">{requirement.met ? "✓" : "○"}</span>
            <span>
              {requirement.label}
              <span className={styles.srOnly}>{requirement.met ? " (cumplido)" : " (pendiente)"}</span>
            </span>
          </li>
        ))}
      </ul>
      <p>{PASSWORD_REQUIREMENTS_NOTE}</p>
    </div>
  );
}
