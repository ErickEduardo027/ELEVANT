import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { Card, PrimaryButton } from '../../components/ui';
import { flights } from '../../data/mock';
import { addToOutbox } from '../../storage/prototype-storage';
import { colors } from '../../theme/colors';

const types = ['Operativa', 'Seguridad', 'Equipo', 'Documentación'];
const impacts = ['Bajo', 'Medio', 'Alto'];
export default function IncidentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const flight = flights.find(x => x.id === id) ?? flights[0];
  const [type, setType] = useState('Operativa'); const [impact, setImpact] = useState('Medio'); const [description, setDescription] = useState(''); const [image, setImage] = useState<string>();
  const camera = async () => { const permission = await ImagePicker.requestCameraPermissionsAsync(); if (!permission.granted) return Alert.alert('Permiso requerido', 'Autoriza la cámara para adjuntar evidencia.'); const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.65 }); if (!result.canceled) setImage(result.assets[0].uri); };
  const gallery = async () => { const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.65 }); if (!result.canceled) setImage(result.assets[0].uri); };
  const save = async () => { if (description.trim().length < 8) return Alert.alert('Descripción requerida', 'Explica brevemente qué ocurrió.'); await addToOutbox('incidencia', `${flight.number} · ${type} · ${impact}`); Alert.alert('Incidencia guardada', 'Se almacenó localmente y aparecerá en la cola de sincronización.', [{ text: 'Aceptar', onPress: () => router.back() }]); };
  return <ScrollView contentContainerStyle={styles.container}>
    <Card><Text style={styles.flight}>{flight.number} · {flight.position}</Text><Text style={styles.muted}>{flight.airline} · {flight.aircraft}</Text></Card>
    <Text style={styles.label}>Tipo de incidencia</Text><View style={styles.chips}>{types.map(x => <Pressable key={x} onPress={() => setType(x)} style={[styles.chip, type === x && styles.chipActive]}><Text style={[styles.chipText, type === x && styles.chipTextActive]}>{x}</Text></Pressable>)}</View>
    <Text style={styles.label}>Impacto</Text><View style={styles.chips}>{impacts.map(x => <Pressable key={x} onPress={() => setImpact(x)} style={[styles.chip, impact === x && (x === 'Alto' ? styles.high : styles.chipActive)]}><Text style={[styles.chipText, impact === x && styles.chipTextActive]}>{x}</Text></Pressable>)}</View>
    <Text style={styles.label}>Descripción</Text><TextInput value={description} onChangeText={setDescription} multiline placeholder="Describe la situación observada..." style={styles.textarea} />
    <Text style={styles.label}>Evidencia fotográfica</Text>{image ? <Image source={{ uri: image }} style={styles.photo} /> : <View style={styles.placeholder}><Ionicons name="image-outline" size={38} color={colors.muted} /><Text style={styles.muted}>No se ha adjuntado evidencia</Text></View>}
    <View style={styles.photoButtons}><View style={styles.flex}><PrimaryButton title="Cámara" icon="camera-outline" onPress={camera} secondary /></View><View style={styles.flex}><PrimaryButton title="Galería" icon="images-outline" onPress={gallery} secondary /></View></View>
    <PrimaryButton title="GUARDAR INCIDENCIA" icon="save-outline" onPress={save} />
  </ScrollView>;
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 35 }, flight: { color: colors.navy, fontSize: 19, fontWeight: '900' }, muted: { color: colors.muted, marginTop: 4 }, label: { color: colors.ink, fontWeight: '900', marginTop: 5 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 9 }, chipActive: { backgroundColor: colors.navy, borderColor: colors.navy }, high: { backgroundColor: colors.danger, borderColor: colors.danger }, chipText: { color: colors.muted, fontWeight: '700' }, chipTextActive: { color: colors.white }, textarea: { minHeight: 120, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, padding: 14, textAlignVertical: 'top', fontSize: 15 }, placeholder: { height: 150, backgroundColor: colors.white, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 14, alignItems: 'center', justifyContent: 'center', gap: 5 }, photo: { width: '100%', height: 210, borderRadius: 14 }, photoButtons: { flexDirection: 'row', gap: 10 }, flex: { flex: 1 },
});
