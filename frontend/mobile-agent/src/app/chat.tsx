import type { OperationConversationResponse, OperationMessageResponse } from '@elevant/api-client';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components/ui';
import { MobileServiceError } from '../services/mobile-service-error';
import { subscribeMobileChanges } from '../services/mobile-change-feed';
import {
  getOperationalConversations, getOperationalMessages, markOperationalConversationRead,
  readPendingOperationMessage, sendOperationalMessage,
} from '../services/operational-communication';
import { colors } from '../theme/colors';
import { resetToLogin } from '../utils/session-navigation';
import { formatLocalDateTime } from '../utils/date-format';
import { startForegroundInterval } from '../utils/foreground-interval';
import { getMobileSession } from '../services/mobile-auth';

const messageKey = (item: OperationMessageResponse) => item.id;

/** «Visto» once OCC's read cursor reaches the message (ADR-0029). */
export function isSeenByOthers(message: Pick<OperationMessageResponse, 'sentAt'>, othersReadUpTo?: string | null) {
  if (!othersReadUpTo) return false;
  const sent = Date.parse(message.sentAt);
  const read = Date.parse(othersReadUpTo);
  return Number.isFinite(sent) && Number.isFinite(read) && sent <= read;
}

function messageError(error: unknown) {
  if (error instanceof MobileServiceError) {
    if (error.code === 'unauthenticated' || error.code === 'session_expired') {
      resetToLogin('session_expired'); return 'La sesión expiró.';
    }
    if (error.code === 'forbidden') { resetToLogin('access_revoked'); return 'Ya no tienes permiso.'; }
    return error.message;
  }
  return 'No fue posible completar la solicitud.';
}

export default function ChatScreen() {
  const { operationId } = useLocalSearchParams<{ operationId?: string }>();
  const [conversations, setConversations] = useState<readonly OperationConversationResponse[]>([]);
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly OperationMessageResponse[]>([]);
  const [othersReadUpTo, setOthersReadUpTo] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const markedRef = useRef<Record<string, string>>({});
  const [messagesStatus, setMessagesStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ content: string; idempotencyKey: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [listRevision, setListRevision] = useState(0);
  const [messageRevision, setMessageRevision] = useState(0);
  const loadedConversationRef = useRef<string | null>(null);
  const messagesRef = useRef<FlatList<OperationMessageResponse>>(null);

  useFocusEffect(useCallback(() => subscribeMobileChanges(resources => {
    if (resources.includes('operation_messages')) {
      setListRevision(value => value + 1);
      setMessageRevision(value => value + 1);
    }
  }), []));

  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await getOperationalConversations(controller.signal);
        if (controller.signal.aborted) return;
        setConversations(result.conversations);
        setListStatus('ready');
        setSelected(current => current && result.conversations.some(item => item.operationId === current)
          ? current : result.conversations.find(item => item.operationId === operationId)?.operationId ?? null);
      } catch (error) {
        if (!controller.signal.aborted) { messageError(error); setListStatus('error'); }
      }
    };
    // Solo la primera carga muestra el indicador; después se revalida en sitio.
    setListStatus(current => (current === 'ready' ? current : 'loading'));
    void load();
    const stopPolling = startForegroundInterval(() => void load(), 20_000);
    return () => { controller.abort(); stopPolling(); };
    // A retry changes listRevision to restart this focus-scoped request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationId, listRevision]));

  useFocusEffect(useCallback(() => {
    if (!selected) { setMessages([]); setMessagesStatus('idle'); return undefined; }
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await getOperationalMessages(selected, controller.signal);
        if (!controller.signal.aborted) {
          setMessages(result.messages); setOthersReadUpTo(result.othersReadUpTo ?? null);
          setMessagesStatus('ready'); loadedConversationRef.current = selected;
        }
      } catch (error) {
        if (!controller.signal.aborted) { messageError(error); setMessagesStatus('error'); }
      }
    };
    if (loadedConversationRef.current !== selected) setMessagesStatus('loading');
    void load();
    const stopPolling = startForegroundInterval(() => void load(), 10_000);
    return () => { controller.abort(); stopPolling(); };
    // A retry changes messageRevision to restart this focus-scoped request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, messageRevision]));

  useEffect(() => {
    let active = true;
    getMobileSession().then(session => { if (active) setAccountId(session?.actor.accountId ?? null); }).catch(() => {});
    return () => { active = false; };
  }, []);

  // The open thread counts as read up to its newest message; the list then drops its badge.
  const newestId = messagesStatus === 'ready' ? messages.at(-1)?.id : undefined;
  useEffect(() => {
    if (!selected || !newestId || markedRef.current[selected] === newestId) return;
    markedRef.current[selected] = newestId;
    markOperationalConversationRead(selected, newestId)
      .then(() => setConversations(items => items.map(item => item.operationId === selected ? { ...item, unreadCount: 0 } : item)))
      .catch(() => { delete markedRef.current[selected]; });
  }, [selected, newestId]);

  const renderMessage = useCallback(({ item }: { item: OperationMessageResponse }) => {
    const own = accountId !== null && item.senderAccountId === accountId;
    return <View style={[styles.bubble, own && styles.ownBubble]}><Text style={styles.byline}>{item.senderName} · {item.senderRole === 'occ' ? 'OCC' : 'Agente'} · {formatLocalDateTime(item.sentAt)}</Text><Text style={styles.messageText}>{item.content}</Text>{own ? <Text style={styles.receipt}>{isSeenByOthers(item, othersReadUpTo) ? '✓✓ Visto por OCC' : '✓ Enviado'}</Text> : null}</View>;
  }, [accountId, othersReadUpTo]);

  useEffect(() => {
    if (!selected) { setPending(null); setDraft(''); return; }
    let active = true;
    readPendingOperationMessage(selected).then(result => {
      if (active && result.kind === 'current') {
        setPending(result.command);
        setDraft(result.command?.content ?? '');
      }
    }).catch(error => { if (active) setSendError(messageError(error)); });
    return () => { active = false; };
  }, [selected]);

  const submit = async () => {
    if (!selected || sending || (!pending && !draft.trim())) return;
    setSending(true);
    setSendError('');
    try {
      await sendOperationalMessage(selected, pending?.content ?? draft);
      setPending(null);
      setDraft('');
      setMessageRevision(value => value + 1);
      setListRevision(value => value + 1);
    } catch (error) {
      setSendError(messageError(error));
      const command = await readPendingOperationMessage(selected).catch(() => null);
      if (command?.kind === 'current') setPending(command.command);
    } finally { setSending(false); }
  };

  const current = conversations.find(item => item.operationId === selected);
  return <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0} style={styles.safe}>
    <View style={styles.header}><Text style={styles.title}>Chat con OCC</Text><Text style={styles.subtitle}>Mensajes guardados por operación. Requiere conexión segura.</Text></View>
    {listStatus === 'loading' ? <ActivityIndicator color={colors.navy} /> : listStatus === 'error' ? <View style={styles.notice}><Text>No fue posible cargar tus conversaciones.</Text><PrimaryButton title="REINTENTAR" onPress={() => setListRevision(value => value + 1)} secondary /></View> :
      conversations.length === 0 ? <View style={styles.notice}><Text>No tienes operaciones con conversación disponible.</Text></View> : <>
        <ScrollView horizontal style={styles.conversationStrip} contentContainerStyle={styles.conversationItems} accessibilityLabel="Operaciones con chat">
          {conversations.map(item => <Pressable key={item.operationId} accessibilityRole="button" accessibilityState={{ selected: selected === item.operationId, disabled: Boolean(pending) }} disabled={Boolean(pending)} onPress={() => setSelected(item.operationId)} style={[styles.conversation, selected === item.operationId && styles.selectedConversation]}><View style={styles.conversationRow}><Text style={styles.conversationTitle}>{item.operationCode}</Text>{item.unreadCount > 0 && selected !== item.operationId ? <View accessibilityLabel={`${item.unreadCount} mensajes sin leer`} style={styles.unreadBadge}><Text style={styles.unreadText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text></View> : null}</View><Text style={styles.conversationStation}>{item.stationCode}</Text></Pressable>)}
        </ScrollView>
        {current && <><View style={styles.operationHeader}><Text style={styles.operationTitle}>{current.operationCode}</Text><Text>{current.airlineName} · {current.agentName ?? 'Agente de rampa'}</Text></View>
          {messagesStatus === 'loading' ? <ActivityIndicator color={colors.navy} style={styles.messages} /> : messagesStatus === 'error' ? <View style={[styles.notice, styles.messages]}><Text>No fue posible cargar los mensajes.</Text><PrimaryButton title="REINTENTAR" onPress={() => setMessageRevision(value => value + 1)} secondary /></View> :
            <FlatList ref={messagesRef} accessibilityLabel="Mensajes de la operación" contentContainerStyle={styles.messageItems} data={messages} keyExtractor={messageKey} keyboardShouldPersistTaps="handled" ListEmptyComponent={<Text style={styles.empty}>Aún no hay mensajes.</Text>} onContentSizeChange={() => messagesRef.current?.scrollToEnd({ animated: false })} renderItem={renderMessage} style={styles.messages} />}
          <View style={styles.composer}><TextInput accessibilityLabel="Escribir mensaje" editable={!pending && !sending} multiline maxLength={2000} onChangeText={setDraft} placeholder="Escribe a OCC…" style={styles.input} value={pending?.content ?? draft} />{sendError ? <Text accessibilityRole="alert" style={styles.error}>{sendError} {pending ? 'Reintenta con el mismo mensaje.' : ''}</Text> : null}<PrimaryButton title={sending ? 'ENVIANDO…' : pending ? 'REINTENTAR ENVÍO' : 'ENVIAR MENSAJE'} onPress={() => void submit()} disabled={sending || (!pending && !draft.trim())} /></View>
        </>}
      </>}
  </KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  conversationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unreadBadge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.navy },
  unreadText: { color: colors.white, fontSize: 12, fontWeight: '900' },
  ownBubble: { alignSelf: 'flex-end' },
  receipt: { marginTop: 4, textAlign: 'right', fontSize: 11, color: colors.muted },
  header: { padding: 18, backgroundColor: colors.navy },
  title: { color: colors.white, fontSize: 22, fontWeight: '900' },
  subtitle: { color: '#D5E2F5', fontSize: 12, marginTop: 4 },
  conversationStrip: { flexGrow: 0, maxHeight: 86 },
  conversationItems: { gap: 8, padding: 12 },
  conversation: { minWidth: 110, minHeight: 56, borderRadius: 12, padding: 10, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border },
  selectedConversation: { borderColor: colors.blue, backgroundColor: colors.paleBlue },
  conversationTitle: { color: colors.navy, fontWeight: '800' },
  conversationStation: { color: colors.muted, fontSize: 12 },
  operationHeader: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  operationTitle: { fontSize: 17, fontWeight: '800', color: colors.ink },
  messages: { flex: 1 },
  messageItems: { padding: 14, gap: 10 },
  bubble: { padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  byline: { fontSize: 11, fontWeight: '700', color: colors.muted, marginBottom: 5 },
  messageText: { fontSize: 15, color: colors.ink },
  empty: { marginTop: 20, textAlign: 'center', color: colors.muted },
  composer: { padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.white, gap: 8 },
  input: { minHeight: 50, maxHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, textAlignVertical: 'top' },
  error: { color: colors.danger, fontSize: 12 },
  notice: { padding: 20, gap: 12 },
});
