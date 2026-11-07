"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ElevantApiError, type AirlinePortalUserData, type AirlinePortalUsersData } from "@elevant/api-client";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { createCommandKeyHolder } from "@/lib/command-key";
import { portalUserProblem } from "@/lib/portal-user-problems";
import styles from "./AirlinePortalPage.module.css";

type ListState =
  | { status: "loading"; data: null }
  | { status: "ready"; data: AirlinePortalUsersData }
  | { status: "error" | "forbidden"; data: null };

type Message = { tone: "ok" | "error"; text: string } | null;

const EMPTY_INVITE = { firstName: "", lastName: "", email: "", signer: false };

const nameOf = (user: AirlinePortalUserData) => `${user.firstName} ${user.lastName}`.trim();
const lastLogin = (value: string | null | undefined) => value
  ? `Último acceso: ${new Date(value).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" })}`
  : "Todavía no ha entrado al portal";

/** What the session may do, in the airline's words (2-N20). */
function capabilityText(me: AirlinePortalUsersData["me"], airline: string) {
  if (me.representative)
    return `Usted es representante de ${airline}: invita, desactiva y reactiva usuarios, marca a los firmantes y firma contratos.`;
  if (me.signer) return `Usted firma los contratos y envía los permisos de operación de ${airline}.`;
  return `Su usuario consulta la información de ${airline}. Solo los representantes y los firmantes firman contratos y envían los permisos de operación.`;
}

/**
 * «Usuarios del portal» of the profile (phase 2, block E, 2-N20): every user of the airline sees who has access and
 * who signs; a representative invites users by email, deactivates and reactivates them and marks signers, never
 * itself nor another representative (AVIAM manages those). Every command carries the intent's Idempotency-Key and,
 * for an existing user, its version; a refused or changed user re-reads the list.
 */
export function AirlinePortalUsersSection({ airlineName }: { airlineName: string }) {
  const { getPortalUsers, invitePortalUser, setPortalUserStatus, setPortalUserSigner } = useAirlineSession();
  const [list, setList] = useState<ListState>({ status: "loading", data: null });
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [invite, setInvite] = useState(EMPTY_INVITE);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const inviteKeys = useRef(createCommandKeyHolder());
  const userKeys = useRef(createCommandKeyHolder());
  const loaded = useRef(false);

  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    getPortalUsers().then(data => {
      if (!active) return;
      loaded.current = true;
      setList({ status: "ready", data });
      setRefreshFailed(false);
    }).catch(error => {
      if (!active) return;
      if (error instanceof ElevantApiError && error.status === 403) {
        loaded.current = false;
        setList({ status: "forbidden", data: null });
      } else if (loaded.current) setRefreshFailed(true);
      else setList({ status: "error", data: null });
    });
    return () => { active = false; };
  }, [getPortalUsers, revision]);

  async function command(id: string, run: () => Promise<unknown>, done: string) {
    setBusy(id); setMessage(null);
    try {
      await run();
      setConfirming(null);
      setMessage({ tone: "ok", text: done });
      reload();
    } catch (error) {
      const problem = portalUserProblem(error);
      setMessage({ tone: "error", text: problem.text });
      if (problem.reload) { setConfirming(null); reload(); }
    } finally { setBusy(null); }
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { firstName: invite.firstName.trim(), lastName: invite.lastName.trim(), email: invite.email.trim(),
      signer: invite.signer };
    if (body.firstName.length < 2 || body.lastName.length < 2 || !body.email) {
      setMessage({ tone: "error", text: "Escriba el nombre, el apellido y el correo de la persona que invita." });
      return;
    }
    await command("invite", async () => {
      await inviteKeys.current.run("portal-user.invite", body, key => invitePortalUser(body, key));
      setInvite(EMPTY_INVITE);
    }, `La invitación a ${body.email} quedó en cola; el enlace de activación vence en 72 horas.` +
      (body.signer ? " Podrá firmar contratos y enviar los permisos de operación." : ""));
  }

  const setStatus = (user: AirlinePortalUserData, isActive: boolean) => command(user.id, () => userKeys.current.run(
    "portal-user.status", { id: user.id, isActive, version: user.version },
    key => setPortalUserStatus(user.id, { isActive, expectedVersion: user.version }, key)),
  isActive ? `${nameOf(user)} puede volver a entrar al portal.` : `${nameOf(user)} ya no puede entrar al portal.`);

  const setSigner = (user: AirlinePortalUserData, signer: boolean) => command(user.id, () => userKeys.current.run(
    "portal-user.signer", { id: user.id, signer, version: user.version },
    key => setPortalUserSigner(user.id, { signer, expectedVersion: user.version }, key)),
  signer ? `${nameOf(user)} ahora puede firmar contratos y enviar los permisos de operación.`
    : `${nameOf(user)} ya no firma contratos ni envía permisos.`);

  const data = list.data;
  const me = data?.me;
  const others = data?.users.filter(user => user.id !== me?.accountId) ?? [];

  return <section className={styles.panel} aria-labelledby="portal-users-heading">
    <div className={styles.sectionHeading}>
      <div><span className={styles.kicker}>Accesos de la aerolínea</span><h2 id="portal-users-heading">Usuarios del portal</h2></div>
      {me && <strong className={me.canSign ? styles.permitOk : styles.permitMissing}>
        {me.representative ? "Representante" : me.signer ? "Firmante" : "Solo consulta"}</strong>}
    </div>
    {list.status === "loading" && <p role="status">Cargando los usuarios del portal…</p>}
    {list.status === "forbidden" && <p role="alert">Su cuenta no puede consultar los usuarios del portal.</p>}
    {list.status === "error" && <div role="alert"><p>No se pudieron cargar los usuarios del portal.</p>
      <button className={styles.loadMore} type="button" onClick={() => { setList({ status: "loading", data: null }); reload(); }}>
        Reintentar</button></div>}
    {refreshFailed && <div role="alert"><p>No se pudo actualizar la lista de usuarios.</p>
      <button className={styles.loadMore} type="button" onClick={reload}>Reintentar</button></div>}
    {data && me && <>
      <p className={styles.note}>{capabilityText(me, airlineName)}</p>
      {me.canManageUsers && <p className={styles.note}>Cada cambio deja en cola un aviso por correo para los demás representantes de la aerolínea. A los representantes los gestiona AVIAM.</p>}
      {others.length === 0 && <p className={styles.empty}>{me.canManageUsers
        ? "Todavía no hay otros usuarios del portal. Invite a su equipo con el formulario."
        : "No hay otros usuarios del portal en su aerolínea."}</p>}
      {data.users.length > 0 && <ul className={styles.draftComments} aria-label="Usuarios del portal">
        {data.users.map(user => {
          const self = user.id === me.accountId;
          const managed = me.canManageUsers && !self && !user.representative;
          const active = user.status === "Active";
          return <li key={user.id}>
            <strong>{nameOf(user)}{self ? " (usted)" : ""}</strong>
            <p>{user.email}</p>
            <p>{[user.representative && "Representante", user.signer && "Firmante",
              user.invitationPending && "Invitación pendiente de activar", !active && "Inactivo"].filter(Boolean).join(" · ")
              || "Consulta"}</p>
            <small>{lastLogin(user.lastLoginAt)}</small>
            {managed && <div className={styles.actions}>
              {active && <button type="button" disabled={busy !== null} onClick={() => void setSigner(user, !user.signer)}>
                {user.signer ? "Quitar firmante" : "Marcar como firmante"}</button>}
              {active
                ? <button type="button" disabled={busy !== null} onClick={() => setConfirming(user.id)}>Desactivar</button>
                : <button type="button" disabled={busy !== null} onClick={() => void setStatus(user, true)}>Reactivar</button>}
            </div>}
            {managed && confirming === user.id && <div role="group" aria-label={`Desactivar a ${nameOf(user)}`}>
              <p>{nameOf(user)} perderá el acceso al portal de inmediato.</p>
              <div className={styles.actions}>
                <button type="button" disabled={busy !== null} onClick={() => void setStatus(user, false)}>
                  {busy === user.id ? "Desactivando…" : "Confirmar desactivación"}</button>
                <button type="button" disabled={busy !== null} onClick={() => setConfirming(null)}>Cancelar</button>
              </div>
            </div>}
          </li>;
        })}
      </ul>}
      {me.canManageUsers && <form onSubmit={submitInvite} noValidate className={styles.draftCommentForm}
        aria-label="Invitar a un usuario">
        <label htmlFor="portal-user-first-name">Nombre</label>
        <input id="portal-user-first-name" maxLength={100} value={invite.firstName}
          onChange={event => setInvite(current => ({ ...current, firstName: event.target.value }))} />
        <label htmlFor="portal-user-last-name">Apellido</label>
        <input id="portal-user-last-name" maxLength={100} value={invite.lastName}
          onChange={event => setInvite(current => ({ ...current, lastName: event.target.value }))} />
        <label htmlFor="portal-user-email">Correo</label>
        <input id="portal-user-email" type="email" maxLength={256} value={invite.email}
          onChange={event => setInvite(current => ({ ...current, email: event.target.value }))} />
        <label><input type="checkbox" checked={invite.signer}
          onChange={event => setInvite(current => ({ ...current, signer: event.target.checked }))} />{" "}
          Puede firmar contratos y enviar los permisos de operación</label>
        <button type="submit" disabled={busy !== null}>{busy === "invite" ? "Invitando…" : "Invitar usuario"}</button>
      </form>}
    </>}
    {message && <p role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}
  </section>;
}
