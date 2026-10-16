import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SignaturePad } from '../../components/signature-pad';
import { Card, PrimaryButton } from '../../components/ui';
import {
  importEvidencePhoto,
  readOperationEvidence,
  removeEvidencePhoto,
  saveOperationEvidence,
  type EvidencePhoto,
} from '../../storage/operation-evidence';
import { colors } from '../../theme/colors';

export default function EvidenceScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [responsibleName, setResponsibleName] = useState('');
  const [bridgeKeyDelivered, setBridgeKeyDelivered] = useState(false);
  const [observations, setObservations] = useState('');
  const [signaturePaths, setSignaturePaths] = useState<readonly string[]>([]);
  const [photos, setPhotos] = useState<readonly EvidencePhoto[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (typeof id !== 'string') return;
    try {
      const draft = await readOperationEvidence(id);
      setResponsibleName(draft.responsibleName);
      setBridgeKeyDelivered(draft.bridgeKeyDelivered);
      setObservations(draft.observations);
      setSignaturePaths(draft.signaturePaths);
      setPhotos(draft.photos);
    } catch {
      setNotice('No pudimos leer las evidencias guardadas.');
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const persist = useCallback(async (
    nextPhotos: readonly EvidencePhoto[] = photos,
    nextPaths: readonly string[] = signaturePaths,
  ) => {
    if (typeof id !== 'string') return;
    setSaving(true);
    try {
      await saveOperationEvidence(id, {
        responsibleName: responsibleName.trim(),
        bridgeKeyDelivered,
        observations: observations.trim(),
        signaturePaths: nextPaths,
        photos: nextPhotos,
      });
      setNotice('Evidencias guardadas en este dispositivo y pendientes de carga.');
    } catch {
      setNotice('No pudimos guardar. Conserva esta pantalla abierta y vuelve a intentar.');
    } finally {
      setSaving(false);
    }
  }, [bridgeKeyDelivered, id, observations, photos, responsibleName, signaturePaths]);

  const addPhoto = useCallback(async (camera: boolean) => {
    if (typeof id !== 'string') return;
    const permission = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setNotice('Debes autorizar el acceso para adjuntar una fotografía.');
      return;
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.75 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.75 });
    if (result.canceled || !result.assets[0]?.uri) return;
    try {
      const photo = await importEvidencePhoto(id, result.assets[0].uri);
      const next = [...photos, photo];
      setPhotos(next);
      await persist(next);
    } catch {
      setNotice('No pudimos conservar la fotografía en el dispositivo.');
    }
  }, [id, persist, photos]);

  const deletePhoto = useCallback(async (photo: EvidencePhoto) => {
    const next = photos.filter(item => item.id !== photo.id);
    await removeEvidencePhoto(photo).catch(() => undefined);
    setPhotos(next);
    await persist(next);
  }, [persist, photos]);

  return <SafeAreaView edges={['bottom']} style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Ionicons name="document-attach-outline" size={30} color={colors.orange} />
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>TRAZABILIDAD OPERATIVA</Text>
          <Text style={styles.title}>Evidencias y conformidad</Text>
          <Text style={styles.subtitle}>La información queda protegida localmente hasta que pueda cargarse al servidor.</Text>
        </View>
      </View>

      {!!notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Responsable y entrega</Text>
        <Text style={styles.label}>Nombre del responsable</Text>
        <TextInput value={responsibleName} onChangeText={setResponsibleName} maxLength={120} placeholder="Nombre completo" placeholderTextColor={colors.muted} style={styles.input} />
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.label}>Llave del puente entregada</Text>
            <Text style={styles.helper}>Confirma la entrega o recepción física.</Text>
          </View>
          <Switch value={bridgeKeyDelivered} onValueChange={setBridgeKeyDelivered} trackColor={{ true: colors.success }} />
        </View>
        <Text style={styles.label}>Observaciones finales</Text>
        <TextInput value={observations} onChangeText={setObservations} maxLength={2000} multiline textAlignVertical="top" placeholder="Novedades de entrega, walk-around o anomalías…" placeholderTextColor={colors.muted} style={[styles.input, styles.multiline]} />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Evidencia fotográfica</Text>
        <View style={styles.photoActions}>
          <View style={styles.action}><PrimaryButton title="CÁMARA" icon="camera-outline" onPress={() => void addPhoto(true)} secondary /></View>
          <View style={styles.action}><PrimaryButton title="GALERÍA" icon="images-outline" onPress={() => void addPhoto(false)} secondary /></View>
        </View>
        <View style={styles.photos}>
          {photos.map(photo => <View key={photo.id} style={styles.photoWrap}>
            <Image source={{ uri: photo.localUri }} style={styles.photo} />
            <Pressable accessibilityLabel="Eliminar fotografía" onPress={() => void deletePhoto(photo)} style={styles.remove}>
              <Ionicons name="trash" size={18} color={colors.white} />
            </Pressable>
          </View>)}
          {photos.length === 0 && <Text style={styles.helper}>Todavía no hay fotografías adjuntas.</Text>}
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Firma manuscrita</Text>
        <Text style={styles.helper}>Firma dentro del recuadro con el dedo o lápiz digital.</Text>
        <SignaturePad paths={signaturePaths} onChange={setSignaturePaths} />
      </Card>

      <PrimaryButton disabled={saving} icon="save-outline" title={saving ? 'GUARDANDO…' : 'GUARDAR EVIDENCIAS'} onPress={() => void persist()} />
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 18, paddingBottom: 42, gap: 14 },
  header: { flexDirection: 'row', gap: 13, alignItems: 'center', paddingVertical: 8 },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: colors.ink, fontSize: 23, fontWeight: '900', marginTop: 3 },
  subtitle: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  notice: { color: colors.warning, fontSize: 12, fontWeight: '700', backgroundColor: '#FFF8EA', borderRadius: 12, padding: 11 },
  card: { gap: 10 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  label: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  helper: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 13, color: colors.ink, backgroundColor: colors.white },
  multiline: { minHeight: 100, paddingTop: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchCopy: { flex: 1 },
  photoActions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  photoWrap: { width: 112, height: 112 },
  photo: { width: '100%', height: '100%', borderRadius: 12, backgroundColor: colors.border },
  remove: { position: 'absolute', right: 5, top: 5, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
});
