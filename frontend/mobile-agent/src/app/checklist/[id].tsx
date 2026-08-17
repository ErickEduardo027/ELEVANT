import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Card, PrimaryButton, StatusPill } from '../../components/ui';
import { checklistSections, Flight } from '../../data/mock';
import { addToOutbox, ChecklistAnswer, getChecklist, getOperationState, OperationState, saveChecklist } from '../../storage/prototype-storage';
import { colors } from '../../theme/colors';
import { getAssignedFlight } from '../../services/assigned-flights';

type Answers = Record<string, ChecklistAnswer>;
export default function ChecklistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [flight, setFlight] = useState<Flight>();
  const [sectionIndex, setSectionIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [operation, setOperation] = useState<OperationState>();
  const section = checklistSections[sectionIndex];
  const total = checklistSections.reduce((sum, item) => sum + item.items.length, 0);
  useEffect(() => { getAssignedFlight(id).then(found => { setFlight(found); if (found) Promise.all([getChecklist(found.id), getOperationState(found.id, total)]).then(([record, state]) => { setAnswers(record.answers); setOperation(state); }); }); }, [id, total]);
  const completed = Object.keys(answers).length;
  const sectionCompleted = useMemo(() => section.items.every((_, i) => answers[`${section.id}:${i}`]), [answers, section]);
  if (!flight) return <View style={styles.notFound}><Text style={styles.title}>Vuelo no encontrado</Text><Text style={styles.help}>El identificador recibido no corresponde a un vuelo asignado.</Text><PrimaryButton title="VOLVER" icon="arrow-back" onPress={() => router.back()} /></View>;
  if (!operation) return <View style={styles.notFound}><Text style={styles.title}>Cargando checklist…</Text><Text style={styles.help}>Verificando el estado de la operación.</Text></View>;
  if (operation && !operation.startedAt) return <View style={styles.notFound}><Text style={styles.title}>Checklist no disponible</Text><Text style={styles.help}>Primero debes iniciar la atención operativa del vuelo.</Text><PrimaryButton title="VOLVER AL VUELO" icon="arrow-back" onPress={() => router.back()} /></View>;
  const readOnly = Boolean(operation?.endedAt);
  const choose = async (key: string, value: ChecklistAnswer) => { if (readOnly) return; const next = { ...answers, [key]: value }; setAnswers(next); await saveChecklist(flight.id, { answers: next }); };
  const nextSection = () => {
    if (!readOnly && !sectionCompleted) return Alert.alert('Sección incompleta', 'Responde todas las verificaciones antes de continuar.');
    setSectionIndex(sectionIndex + 1);
  };
  const selectSection = (targetIndex: number) => {
    if (readOnly || targetIndex <= sectionIndex) return setSectionIndex(targetIndex);
    const firstIncomplete = checklistSections.slice(0, targetIndex).findIndex(candidate => candidate.items.some((_, itemIndex) => !answers[`${candidate.id}:${itemIndex}`]));
    if (firstIncomplete >= 0) {
      setSectionIndex(firstIncomplete);
      return Alert.alert('Sección anterior incompleta', `Completa “${checklistSections[firstIncomplete].title}” antes de avanzar.`);
    }
    setSectionIndex(targetIndex);
  };
  const save = async () => {
    if (readOnly) return;
    if (completed !== total) return Alert.alert('Checklist incompleto', `Faltan ${total - completed} verificaciones por responder.`);
    const completedAt = new Date().toISOString();
    await saveChecklist(flight.id, { answers, completedAt });
    await addToOutbox('checklist', `Checklist ${flight.number}: ${completed}/${total}`, { flightId: flight.id, answers, completedAt });
    Alert.alert('Checklist completado', 'El registro quedó almacenado localmente y listo para sincronizar.', [{ text: 'Aceptar', onPress: () => router.back() }]);
  };
  return <View style={styles.screen}>
    <View style={styles.progressBox}><View style={styles.progressHeader}><View><Text style={styles.flight}>{flight.number}</Text>{readOnly && <Text style={styles.readOnly}>Solo lectura · operación finalizada</Text>}</View><StatusPill text={`${completed}/${total}`} tone={completed === total ? 'green' : 'orange'} /></View><View style={styles.progressTrack}><View style={[styles.progress, { width: `${Math.round((completed / total) * 100)}%` }]} /></View></View>
    <View style={styles.tabs}>{checklistSections.map((item, index) => <Pressable key={item.id} onPress={() => selectSection(index)} style={[styles.tab, index === sectionIndex && styles.tabActive]}><Text numberOfLines={2} style={[styles.tabText, index === sectionIndex && styles.tabTextActive]}>{index + 1}. {item.title}</Text></Pressable>)}</View>
    <ScrollView contentContainerStyle={styles.content}><Text style={styles.title}>{section.title}</Text><Text style={styles.help}>{readOnly ? 'Consulta las respuestas registradas. No pueden modificarse.' : 'Marca el resultado de cada verificación.'}</Text>
      {section.items.map((item, i) => { const key = `${section.id}:${i}`; return <Card key={key} style={styles.item}><Text style={styles.itemText}>{String(i + 1).padStart(2, '0')}. {item}</Text><View style={styles.options}>{(['OK','NA','NO'] as ChecklistAnswer[]).map(value => <Pressable key={value} disabled={readOnly} onPress={() => choose(key, value)} style={[styles.option, readOnly && styles.optionLocked, answers[key] === value && (value === 'OK' ? styles.ok : value === 'NA' ? styles.na : styles.no)]}><Text style={[styles.optionText, answers[key] === value && styles.optionSelected]}>{value}</Text></Pressable>)}</View></Card>; })}
      <View style={styles.buttons}>{sectionIndex < checklistSections.length - 1 ? <PrimaryButton title="CONTINUAR" icon="arrow-forward" onPress={nextSection} /> : <PrimaryButton title={readOnly ? 'CHECKLIST FINALIZADO' : 'GUARDAR CHECKLIST'} icon={readOnly ? 'lock-closed-outline' : 'save-outline'} onPress={save} disabled={readOnly} />}</View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, notFound: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 }, progressBox: { backgroundColor: colors.white, padding: 16, borderBottomWidth: 1, borderColor: colors.border }, progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, flight: { color: colors.navy, fontSize: 19, fontWeight: '900' }, readOnly: { color: colors.success, fontSize: 11, fontWeight: '800', marginTop: 3 }, progressTrack: { height: 7, backgroundColor: colors.border, borderRadius: 99, marginTop: 12, overflow: 'hidden' }, progress: { height: 7, backgroundColor: colors.orange, borderRadius: 99 }, tabs: { padding: 12, gap: 8, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: colors.background }, tab: { width: '48%', flexGrow: 1, minHeight: 50, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, tabActive: { backgroundColor: colors.navy, borderColor: colors.navy }, tabText: { color: colors.muted, fontWeight: '800', fontSize: 12, textAlign: 'center' }, tabTextActive: { color: colors.white }, content: { padding: 14, gap: 10, paddingBottom: 40 }, title: { color: colors.ink, fontSize: 21, fontWeight: '900' }, help: { color: colors.muted, marginBottom: 4 }, item: { gap: 12 }, itemText: { color: colors.ink, fontWeight: '700', lineHeight: 20 }, options: { flexDirection: 'row', gap: 8 }, option: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.background, alignItems: 'center', borderWidth: 1, borderColor: colors.border }, optionLocked: { opacity: 0.85 }, optionText: { color: colors.muted, fontWeight: '900' }, optionSelected: { color: colors.white }, ok: { backgroundColor: colors.success }, na: { backgroundColor: colors.warning }, no: { backgroundColor: colors.danger }, buttons: { marginTop: 8 },
});
