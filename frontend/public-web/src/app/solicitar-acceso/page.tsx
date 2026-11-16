import type { Metadata } from "next";
import Link from "next/link";
import { AccessRequestWizard } from "@/components/commercial/AccessRequestWizard";
import "./request.css";

export const metadata: Metadata = {
  title: "Solicitar acceso",
  description: "Seleccione servicios de rampa, identifique su aerolínea y envíe los datos de su representante.",
};

export default function RequestAccessPage() {
  return (
    <main className="access-page">
      <header className="access-header">
        <Link href="/" className="access-header__brand" aria-label="ELEVANT, volver al inicio">E<span>/</span>LEVANT</Link>
        <div className="access-header__context"><span className="access-header__dot" /> AVIAM / ACCESO COMERCIAL</div>
        <Link href="/login" className="access-header__login">Ya tengo acceso <span aria-hidden="true">↗</span></Link>
      </header>
      <AccessRequestWizard />
    </main>
  );
}
