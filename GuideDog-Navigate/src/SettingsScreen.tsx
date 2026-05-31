// src/SettingsScreen.tsx
// Settings for visually impaired users: step length, route type, voice speed

import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { DEFAULT_STEP_LENGTH_M } from "./navigation";
import * as Speech from "expo-speech";

export interface Settings {
  stepLengthM: number;
  quietRoute: boolean;
  voiceRate: number;
  announceEarly: boolean;
  vibration: boolean;

  voiceIdentifier?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  stepLengthM: DEFAULT_STEP_LENGTH_M,
  quietRoute: false,
  voiceRate: 0.88,
  announceEarly: false,
  vibration: true,
  voiceIdentifier: undefined,
};

interface Props {
  visible: boolean;
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export default function SettingsScreen({ visible, settings, onSave, onClose }: Props) {
  const [local, setLocal] = useState<Settings>(settings);
  const [voices, setVoices] = useState<Speech.Voice[]>([]);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setLocal((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
  Speech.getAvailableVoicesAsync()
    .then(setVoices)
    .catch(console.warn);
}, []);

  const save = () => {
    onSave(local);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={s.root}>
        <View style={s.header}>
          <Text style={s.title}>Settings</Text>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <Text style={s.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.content}>

          {/* ── Step length ── */}
          <Text style={s.sectionTitle}>Your Step Length</Text>
          <Text style={s.sectionSub}>
            Average is 0.80 m (about 7,500 steps = 6 km per day).
            Measure yours by counting 10 steps and dividing the distance by 10.
          </Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              keyboardType="decimal-pad"
              value={String(local.stepLengthM)}
              onChangeText={(t) => {
                const v = parseFloat(t);
                if (!isNaN(v) && v > 0.3 && v < 1.5) update("stepLengthM", v);
              }}
              placeholderTextColor="#475569"
            />
            <Text style={s.inputUnit}>metres / step</Text>
          </View>
          <View style={s.presetRow}>
            {[0.68, 0.75, 0.80, 0.88, 0.95].map((v) => (
              <TouchableOpacity
                key={v}
                style={[s.preset, local.stepLengthM === v && s.presetActive]}
                onPress={() => update("stepLengthM", v)}
              >
                <Text style={[s.presetText, local.stepLengthM === v && s.presetTextActive]}>
                  {v.toFixed(2)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Route type ── */}
          <Text style={s.sectionTitle}>Route Preference</Text>
          <Text style={s.sectionSub}>
            Quiet routes prefer residential streets, parks, and paths with less traffic noise.
            Uses OpenStreetMap road classification data.
          </Text>
          <View style={s.row}>
            <View style={s.rowText}>
              <Text style={s.rowLabel}>Prefer Quiet Route</Text>
              <Text style={s.rowSub}>Avoid busy roads and intersections</Text>
            </View>
            <Switch
              value={local.quietRoute}
              onValueChange={(v) => update("quietRoute", v)}
              trackColor={{ false: "#1e293b", true: "#38BDF8" }}
              thumbColor={local.quietRoute ? "#fff" : "#475569"}
            />
          </View>

          {/* ── Voice ── */}
          <Text style={s.sectionTitle}>Voice & Announcements</Text>

          <Text style={s.rowLabel}>Speech Speed</Text>
          <View style={s.speedRow}>
            {([["Slow", 0.7], ["Normal", 0.88], ["Fast", 1.05]] as [string, number][]).map(
              ([label, rate]) => (
                <TouchableOpacity
                  key={label}
                  style={[s.preset, local.voiceRate === rate && s.presetActive]}
                  onPress={() => update("voiceRate", rate)}
                >
                  <Text style={[s.presetText, local.voiceRate === rate && s.presetTextActive]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>

          <Text style={s.sectionTitle}>Voice</Text>
          <View style={{ gap: 10, marginBottom: 20 }}>
            {voices
              .filter((v) => v.language.startsWith("en"))
              .slice(0, 10)
              .map((voice) => {
                const active =
                  local.voiceIdentifier === voice.identifier;

                return (
                  <TouchableOpacity
                    key={voice.identifier}
                    style={[
                      s.voiceBtn,
                      active && s.voiceBtnActive,
                    ]}
                    onPress={() =>
                      update(
                        "voiceIdentifier",
                        voice.identifier
                      )
                    }
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          s.voiceBtnText,
                          active &&
                            s.voiceBtnTextActive,
                        ]}
                      >
                        {voice.name}
                      </Text>

                      <Text style={s.voiceLang}>
                        {voice.language}
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={() => {
                        Speech.speak(
                          "GuideDog Navigate voice preview.",
                          {
                            voice: voice.identifier,
                            rate: local.voiceRate,
                          }
                        );
                      }}
                    >
                      <Text
                        style={{
                          color: "#38BDF8",
                          fontWeight: "700",
                        }}
                      >
                        Preview
                      </Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
          </View>

          <View style={s.row}>
            <View style={s.rowText}>
              <Text style={s.rowLabel}>Early Announcements</Text>
              <Text style={s.rowSub}>Announce turns at 50 m instead of 30 m</Text>
            </View>
            <Switch
              value={local.announceEarly}
              onValueChange={(v) => update("announceEarly", v)}
              trackColor={{ false: "#1e293b", true: "#38BDF8" }}
              thumbColor={local.announceEarly ? "#fff" : "#475569"}
            />
          </View>

          <View style={s.row}>
            <View style={s.rowText}>
              <Text style={s.rowLabel}>Vibration Feedback</Text>
              <Text style={s.rowSub}>Haptic pulse at each turn</Text>
            </View>
            <Switch
              value={local.vibration}
              onValueChange={(v) => update("vibration", v)}
              trackColor={{ false: "#1e293b", true: "#38BDF8" }}
              thumbColor={local.vibration ? "#fff" : "#475569"}
            />
          </View>

        </ScrollView>

        <View style={s.footer}>
          <TouchableOpacity style={s.saveBtn} onPress={save}>
            <Text style={s.saveBtnText}>Save Settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0f1e" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 56 : 24,
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  title:     { color: "#f1f5f9", fontSize: 22, fontWeight: "800" },
  closeBtn:  { padding: 8 },
  closeText: { color: "#475569", fontSize: 20 },

  scroll:   { flex: 1 },
  content:  { padding: 24, gap: 8 },

  sectionTitle: {
    color: "#38BDF8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 4,
  },
  sectionSub: {
    color: "#475569",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  input: {
    backgroundColor: "#0f172a",
    color: "white",
    fontSize: 20,
    fontWeight: "700",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e293b",
    width: 100,
    textAlign: "center",
  },
  inputUnit: { color: "#64748b", fontSize: 14 },

  presetRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  speedRow:  { flexDirection: "row", gap: 8, marginBottom: 16 },
  preset: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#1e293b",
  },
  presetActive: { backgroundColor: "#38BDF8", borderColor: "#38BDF8" },
  presetText:   { color: "#64748b", fontSize: 14, fontWeight: "600" },
  presetTextActive: { color: "#0a0f1e" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  rowText:  { flex: 1, marginRight: 16 },
  rowLabel: { color: "#f1f5f9", fontSize: 16, fontWeight: "600", marginBottom: 2 },
  rowSub:   { color: "#475569", fontSize: 13 },

  footer: {
    padding: 24,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
  },
  saveBtn: {
    backgroundColor: "#38BDF8",
    padding: 18,
    borderRadius: 16,
    alignItems: "center",
  },
  saveBtnText: { color: "#0a0f1e", fontSize: 17, fontWeight: "800" },
  voiceBtn: {
  backgroundColor: "#0f172a",
  borderWidth: 1,
  borderColor: "#1e293b",
  borderRadius: 16,
  padding: 16,
  flexDirection: "row",
  alignItems: "center",
},

voiceBtnActive: {
  borderColor: "#38BDF8",
  backgroundColor: "#082f49",
},

voiceBtnText: {
  color: "#f1f5f9",
  fontSize: 15,
  fontWeight: "700",
},

voiceBtnTextActive: {
  color: "#38BDF8",
},

voiceLang: {
  color: "#64748b",
  fontSize: 12,
  marginTop: 4,
},
});
