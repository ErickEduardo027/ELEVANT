import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Card, PrimaryButton, StatusPill } from '../../components/ui';
import { checklistSections, flights } from '../../data/mock';
import { addToOutbox, checklistKey, getJson, setJson } from '../../storage/prototype-storage';
import { colors } from '../../theme/colors';

type Answer = 'OK' | 'NA' | 'NO';
type Answers = Record<string, Answer>;
export default function ChecklistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const flight = flights.find(x => x.id === id) ?? flights[0];
  const [sectionIndex, setSectionIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const section = checklistSections[sectionIndex];
  useEffect(() => { getJson<Answers>(checklistKey(flight.id), {}).then(setAnswers); }, [flight.id]);
  const total = checklistSections.reduce((sum, item) => sum + item.items.length, 0);
  const completed = Object.keys(answers).length;
  const sectionCompleted = useMemo(() => section.items.every((_, i) => answers[`${section.id}:${i}`]), [answers, section]);
  const choose = async (key: string, value: Answer) => { const next = { ...answers, [key]: value }; setAnswers(next); await setJson(checklistKey(flight.id), next); };
  const save = async () => { await addToOutbox('checklist', `Checklist ${flight.number}: ${completed}/${total}`); Alert.alert('Checklist guardado', 'El registro quedó almacenado localmente y listo para sincronizar.'); };
  return <View style={styles.screen}>
    <View style={styles.progressBox}><View style={styles.progressHeader}><Text style={styles.flight}>{flight.number}</Text><StatusPill text={`${completed}/${total}`} tone={completed === total ? 'green' : 'orange'} /></View><View style={styles.progressTrack}><View style={[styles.progress, { width: `${Math.round((completed / total) * 100)}%` }]} /></View></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{checklistSections.map((item, index) => <Pressable key={item.id} onPress={() => setSectionIndex(index)} style={[styles.tab, index === sectionIndex && styles.tabActive]}><Text style={[styles.tabText, index === sectionIndex && styles.tabTextActive]}>{index + 1}. {item.title}</Text></Pressable>)}</ScrollView>
    <ScrollView contentContainerStyle={styles.content}><Text style={styles.title}>{section.title}</Text><Text style={styles.help}>Marca el resultado de cada verificación.</Text>
      {section.items.map((item, i) => { const key = `${section.id}:${i}`; return <Card key={key} style={styles.item}><Text style={styles.itemText}>{String(i + 1).padStart(2, '0')}. {item}</Text><View style={styles.options}>{(['OK','NA','NO'] as Answer[]).map(value => <Pressable key={value} onPress={() => choose(key, value)} style={[styles.option, answers[key] === value && (value === 'OK' ? styles.ok : value === 'NA' ? styles.na : styles.no)]}><Text style={[styles.optionText, answers[key] === value && styles.optionSelected]}>{value}</Text></Pressable>)}</View></Card>; })}
      <View style={styles.buttons}>{sectionIndex < checklistSections.length - 1 ? <PrimaryButton title={sectionCompleted ? 'Continuar' : 'Continuar de todos modos'} icon="arrow-forward" onPress={() => setSectionIndex(sectionIndex + 1)} /> : <PrimaryButton title="GUARDAR CHECKLIST" icon="save-outline" onPress={save} />}</View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, progressBox: { backgroundColor: colors.white, padding: 16, borderBottomWidth: 1, borderColor: colors.border }, progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, flight: { color: colors.navy, fontSize: 19, fontWeight: '900' }, progressTrack: { height: 7, backgroundColor: colors.border, borderRadius: 99, marginTop: 12, overflow: 'hidden' }, progress: { height: 7, backgroundColor: colors.orange, borderRadius: 99 }, tabs: { padding: 12, gap: 8 }, tab: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border }, tabActive: { backgroundColor: colors.navy, borderColor: colors.navy }, tabText: { color: colors.muted, fontWeight: '700', fontSize: 12 }, tabTextActive: { color: colors.white }, content: { padding: 14, gap: 10, paddingBottom: 40 }, title: { color: colors.ink, fontSize: 21, fontWeight: '900' }, help: { color: colors.muted, marginBottom: 4 }, item: { gap: 12 }, itemText: { color: colors.ink, fontWeight: '700', lineHeight: 20 }, options: { flexDirection: 'row', gap: 8 }, option: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.background, alignItems: 'center', borderWidth: 1, borderColor: colors.border }, optionText: { color: colors.muted, fontWeight: '900' }, optionSelected: { color: colors.white }, ok: { backgroundColor: colors.success }, na: { backgroundColor: colors.warning }, no: { backgroundColor: colors.danger }, buttons: { marginTop: 8 },
});
