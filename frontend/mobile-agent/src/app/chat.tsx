import { useEffect, useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addToOutbox, ChatMessage, getChatMessages, saveChatMessages } from '../storage/prototype-storage';
import { refreshOccChat } from '../services/mobile-chat';
import { synchronizePendingRecords } from '../services/automatic-sync';
import { colors } from '../theme/colors';

const initialMessages: ChatMessage[] = [{
  id: 'welcome', sender: 'occ', text: 'Canal operativo disponible. ¿En qué podemos ayudarte?', createdAt: new Date().toISOString(),
}];
const quickMessages = ['Solicitar apoyo', 'Reportar retraso', 'Confirmar asignación'];

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [text, setText] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        await synchronizePendingRecords();
        const updated = await refreshOccChat();
        if (mounted) setMessages(updated.length ? updated : initialMessages);
      } catch {
        const saved = await getChatMessages();
        if (mounted && saved.length) setMessages(saved);
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const send = async (value = text) => {
    const clean = value.trim();
    if (!clean) return;
    const now = new Date().toISOString();
    const queued = await addToOutbox('chat', `Mensaje a OCC: ${clean}`, { recipient: 'Administrador / OCC', text: clean, createdAt: now });
    const own: ChatMessage = { id: queued.idempotencyKey, sender: 'agent', text: clean, createdAt: now, pending: true };
    const next = [...messages, own];
    setMessages(next); setText('');
    await saveChatMessages(next);
    void synchronizePendingRecords().then(refreshOccChat).then(setMessages).catch(() => undefined);
  };

  const clear = () => Alert.alert('Limpiar conversación', '¿Deseas borrar el historial local de este chat?', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Borrar', style: 'destructive', onPress: async () => { setMessages(initialMessages); await saveChatMessages(initialMessages); } }]);

  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <View style={styles.contact}><View style={styles.avatar}><Image source={require('../../assets/images/elevant-symbol.png')} style={styles.brandIcon} /></View><View style={styles.contactCopy}><Text style={styles.contactName}>Administrador / OCC</Text><View style={styles.statusRow}><View style={styles.dot} /><Text style={styles.status}>Canal operativo conectado</Text></View></View><Pressable onPress={clear} hitSlop={12}><Ionicons name="trash-outline" size={21} color={colors.muted} /></Pressable></View>
    <View style={styles.notice}><Ionicons name="information-circle-outline" size={18} color={colors.blue} /><Text style={styles.noticeText}>Los mensajes se guardan localmente y se sincronizan automáticamente con OCC.</Text></View>
    <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
      {messages.map(message => <View key={message.id} style={[styles.bubble, message.sender === 'agent' ? styles.agentBubble : styles.occBubble]}><Text style={[styles.messageText, message.sender === 'agent' && styles.agentText]}>{message.text}</Text><Text style={[styles.time, message.sender === 'agent' && styles.agentTime]}>{new Date(message.createdAt).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}{message.pending ? ' · pendiente' : ''}</Text></View>)}
    </ScrollView>
    <View style={styles.quickMessages}>{quickMessages.map(message => <Pressable key={message} onPress={() => send(message)} style={styles.quickChip}><Text numberOfLines={2} style={styles.quickChipText}>{message}</Text></Pressable>)}</View>
    <View style={styles.composer}><TextInput value={text} onChangeText={setText} placeholder="Escribe un mensaje operativo..." multiline style={styles.input} /><Pressable onPress={() => send()} style={styles.send}><Ionicons name="send" size={21} color={colors.white} /></Pressable></View>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, contact: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border }, avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.navy, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, brandIcon: { width: 42, height: 42 }, contactCopy: { flex: 1 }, contactName: { color: colors.ink, fontWeight: '900', fontSize: 16 }, statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success }, status: { color: colors.muted, fontSize: 11 }, notice: { margin: 12, marginBottom: 0, padding: 10, borderRadius: 12, backgroundColor: colors.paleBlue, flexDirection: 'row', gap: 7, alignItems: 'center' }, noticeText: { flex: 1, color: colors.blue, fontSize: 11, lineHeight: 15 }, messages: { flex: 1 }, messagesContent: { padding: 14, gap: 10 }, bubble: { maxWidth: '82%', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 16 }, occBubble: { alignSelf: 'flex-start', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 }, agentBubble: { alignSelf: 'flex-end', backgroundColor: colors.navy, borderBottomRightRadius: 4 }, messageText: { color: colors.ink, lineHeight: 19 }, agentText: { color: colors.white }, time: { color: colors.muted, fontSize: 9, marginTop: 5 }, agentTime: { color: '#B9C9E5', textAlign: 'right' }, quickMessages: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.background }, quickChip: { flex: 1, minWidth: 0, minHeight: 50, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 7, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' }, quickChipText: { color: colors.navy, textAlign: 'center', fontWeight: '800', fontSize: 11, lineHeight: 14 }, composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, padding: 12, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.border }, input: { flex: 1, maxHeight: 100, minHeight: 45, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11, backgroundColor: colors.background }, send: { width: 45, height: 45, borderRadius: 14, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
});
