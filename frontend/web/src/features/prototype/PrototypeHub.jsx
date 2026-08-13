import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getRoleHomePath } from '../auth/roleRouting';
import { getPrototypeToken, prototypeApi, prototypeRequest } from '../../lib/prototypeApi';
import './prototype.css';

const labels = { ADMIN_OCC: 'Administrador / OCC', GESTION_HUMANA: 'Gestión Humana', CONTRATOS: 'Contratos', FINANZAS: 'Finanzas' };
const targetRoles = Object.keys(labels);

export default function PrototypeHub() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [selectedChat, setSelectedChat] = useState(null);
  const [chatText, setChatText] = useState('');
  const [targetRole, setTargetRole] = useState('ADMIN_OCC');
  const [busy, setBusy] = useState(false);
  const role = session?.role;
  const availableTargets = targetRoles.filter(item => item !== role);
  const activeChat = useMemo(() => data?.chats?.find(item => item.id === selectedChat), [data, selectedChat]);

  async function load() {
    const snapshot = await prototypeApi.bootstrap();
    const chats = await prototypeApi.chats();
    setData({ ...snapshot, chats });
    if (!selectedChat && chats[0]) setSelectedChat(chats[0].id);
  }
  useEffect(() => { if (session) load().catch(error => setMessage(error.message)); }, [session]);
  useEffect(() => { if (availableTargets.length && !availableTargets.includes(targetRole)) setTargetRole(availableTargets[0]); }, [role]);

  async function run(action, success) {
    setBusy(true); setMessage('');
    try { await action(); setMessage(success); await load(); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  async function download(format) {
    const response = await fetch(`/api/reports/export?format=${format}`, { headers: { authorization: `Bearer ${getPrototypeToken()}` } });
    if (!response.ok) throw new Error('No fue posible exportar el reporte.');
    const blob = await response.blob();
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `elevant-reporte.${format === 'excel' ? 'xlsx' : 'pdf'}`; link.click(); URL.revokeObjectURL(link.href);
  }

  if (!session) return <Navigate to="/login" replace />;
  if (!data) return <main className="prototype-page"><p>{message || 'Cargando flujo operativo…'}</p></main>;

  const request = data.serviceRequests.find(item => ['SUBMITTED', 'IN_REVIEW'].includes(item.status));
  const agent = data.personnel.find(item => item.available);
  const flight = data.flights[0];
  const operation = data.operations.find(item => item.status === 'PENDING_REVIEW');
  const airlineWithApproved = data.airlines.find(item => data.executedServices.some(service => service.airlineId === item.id && service.status === 'APPROVED' && !service.preinvoiceId));

  return <main className="prototype-page">
    <header className="prototype-header"><div><small>PROTOTIPO INTEGRADO</small><h1>Centro de flujo ELEVANT</h1><p>{labels[role]} · datos persistidos en archivos JSON</p></div><button onClick={() => navigate(getRoleHomePath(role))}>Volver a mi departamento</button></header>
    {message && <p className="prototype-message">{message}</p>}
    <section className="prototype-metrics">
      {Object.entries(data.summary).map(([key, value]) => <article key={key}><strong>{value}</strong><span>{key}</span></article>)}
    </section>
    <section className="prototype-grid">
      <article className="prototype-card"><h2>Solicitud y contrato</h2>{request ? <><p><b>{request.id}</b> · {request.airline}</p><p>{request.title} · {request.status}</p>{role === 'CONTRATOS' && <div className="prototype-actions"><button disabled={busy || request.status !== 'SUBMITTED'} onClick={() => run(() => prototypeApi.reviewRequest(request.id), 'Solicitud puesta en revisión.')}>Iniciar revisión</button><button disabled={busy} onClick={() => run(() => prototypeApi.decideRequest(request.id, { status: 'APPROVED', decisionNote: 'Aprobada para demostración.', contractType: 'TEMPORARY', defaultRate: 300, currency: 'USD' }), 'Contrato temporal creado y notificado a Finanzas y OCC.')}>Aprobar y crear contrato</button></div>}</> : <p>No hay solicitudes pendientes.</p>}</article>
      <article className="prototype-card"><h2>Personal y asignación</h2><p>{agent?.name || 'Sin agente'} · {flight?.number || 'Sin vuelo'}</p>{role === 'GESTION_HUMANA' && <button disabled={busy || !agent} onClick={() => run(() => prototypeApi.allocatePersonnel({ agentId: agent.id, station: 'PUJ', shift: agent.shift }), 'Agente habilitado para OCC.')}>Habilitar personal para OCC</button>}{role === 'ADMIN_OCC' && <button disabled={busy || !flight || !agent} onClick={() => run(() => prototypeApi.assignFlight(flight.id, { agentId: agent.id, gate: flight.gate, services: ['Puente de abordaje', 'GPU', 'Equipaje'] }), 'Vuelo asignado al agente.')}>Asignar vuelo al agente</button>}</article>
      <article className="prototype-card"><h2>Revisión operativa</h2>{operation ? <><p>{operation.id} · pendiente de OCC</p>{role === 'ADMIN_OCC' && <button disabled={busy} onClick={() => run(() => prototypeApi.reviewOperation(operation.id, { status: 'APPROVED', note: 'Operación validada.' }), 'Servicios enviados a Finanzas.')}>Aprobar reporte del agente</button>}</> : <p>No hay reportes operativos pendientes.</p>}</article>
      <article className="prototype-card"><h2>Prefacturación</h2>{role === 'FINANZAS' && airlineWithApproved && <button disabled={busy} onClick={() => run(() => prototypeApi.createPreinvoice({ airlineId: airlineWithApproved.id, period: new Date().toISOString().slice(0, 7), currency: 'USD' }), 'Pre-factura generada.')}>Generar pre-factura</button>}{data.preinvoices.map(item => <div className="prototype-row" key={item.id}><span>{item.id} · {item.status}</span>{role === 'FINANZAS' && item.status === 'DRAFT' && <button onClick={() => run(() => prototypeApi.transitionPreinvoice(item.id, 'approve'), 'Pre-factura aprobada.')}>Aprobar</button>}{role === 'FINANZAS' && item.status === 'APPROVED' && <button onClick={() => run(() => prototypeApi.transitionPreinvoice(item.id, 'send'), 'Pre-factura enviada a la aerolínea.')}>Enviar</button>}</div>)}</article>
      <article className="prototype-card"><h2>Reportes</h2><p>Exportación consolidada con solicitudes, contratos, operaciones, incidencias y facturación.</p><div className="prototype-actions"><button onClick={() => run(() => download('pdf'), 'PDF exportado.')}>Exportar PDF</button><button onClick={() => run(() => download('excel'), 'Excel exportado.')}>Exportar Excel</button></div></article>
      <article className="prototype-card prototype-chat"><h2>Chat entre departamentos</h2><div className="prototype-actions"><select value={targetRole} onChange={event => setTargetRole(event.target.value)}>{availableTargets.map(item => <option key={item} value={item}>{labels[item]}</option>)}</select><button onClick={() => run(async () => { const chat = await prototypeApi.createChat({ title: `${labels[role]} · ${labels[targetRole]}`, participants: [targetRole] }); setSelectedChat(chat.id); }, 'Conversación disponible.')}>Abrir conversación</button></div><div className="prototype-chat-list">{data.chats.map(chat => <button className={selectedChat === chat.id ? 'active' : ''} key={chat.id} onClick={() => setSelectedChat(chat.id)}>{chat.title}</button>)}</div><div className="prototype-messages">{activeChat?.messages?.map(item => <p key={item.id}><b>{item.senderName}:</b> {item.text}<small>{new Date(item.sentAt).toLocaleString('es-DO')}</small></p>)}</div>{activeChat && <form onSubmit={event => { event.preventDefault(); const clean = chatText.trim(); if (!clean) return; run(() => prototypeApi.sendMessage(activeChat.id, clean), 'Mensaje enviado.'); setChatText(''); }}><input value={chatText} onChange={event => setChatText(event.target.value)} placeholder="Escribe un mensaje interno…"/><button>Enviar</button></form>}</article>
    </section>
  </main>;
}
