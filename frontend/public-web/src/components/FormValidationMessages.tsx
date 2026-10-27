"use client";

import { useEffect } from "react";
import { installFormValidation } from "@/lib/forms/formValidation";

/** Mounted once at the root: every form shows the system's own validation messages. */
export function FormValidationMessages() {
  useEffect(() => installFormValidation(document), []);
  return null;
}
