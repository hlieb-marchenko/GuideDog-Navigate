// src/SettingsScreen.tsx
// Liquid Glass Design · Full Accessibility · All Settings Wired

import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Vibration,
} from "react-native";
import { BlurView } from "expo-blur";
import * as Speech from "expo-speech";
import { DEFAULT_STEP_LENGTH_M } from "./navigation";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Settings {
  stepLengthM:      number;
  quietRoute:       boolean;
  voiceRate:        number;
  announceEarly:    boolean;
  vibration:        boolean;
  voiceIdentifier?: string;
  highContrast:     boolean;
  largeText:        boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  stepLengthM:     DEFAULT_STEP_LENGTH_M,
  quietRoute:      false,
  voiceRate:       0.88,
  announceEarly:   false,
  vibration:       true,
  voiceIdentifier: undefined,
  highContrast:    false,
  largeText:       false,
};

interface Props {
  visible:  boolean;
  settings: Settings;
  onSave:   (s: Settings) => void;
  onClose:  () => void;
}

// ─── Liquid Glass colour tokens ───────────────────────────────────────────────

const C = {
  bg:           "#050b18",
  glass:        "rgba(255,255,255,0.06)",
  glassBorder:  "rgba(255,255,255,0.12)",
  glassActive:  "rgba(99,210,255,0.18)",
  accent:       "#63D2FF",
  accentSoft:   "rgba(99,210,255,0.25)",
  accentGreen:  "#6EE7B7",
  text:         "#EEF4FF",
  textSub:      "rgba(238,244,255,0.45)",
  textDim:      "rgba(238,244,255,0.28)",
  glow:         "rgba(99,210,255,0.15)",
  danger:       "#FF6B6B",
};

// ─── Accessible press feedback ────────────────────────────────────────────────

function hapticPress(vibrationEnabled: boolean) {
  if (vibrationEnabled) Vibration.vibrate(30);
}

// ─── Animated Glass Button ────────────────────────────────────────────────────

interface GlassBtnProps {
  label:       string;
  sublabel?:   string;
  active?:     boolean;
  onPress:     () => void;
  vibration:   boolean;
  accessLabel: string;
  accessHint?: string;
}

function GlassBtn({ label, sublabel, active, onPress, vibration: vib, accessLabel, accessHint }: GlassBtnProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn  = () => Animated.spring(scale, { toValue: 0.93, useNativeDriver: true, speed: 50 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 30 }).start();

  const handlePress = () => {
    hapticPress(vib);
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        activeOpacity={1}
        accessibilityLabel={accessLabel}
        accessibilityHint={accessHint}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        style={[gb.btn, active && gb.btnActive]}
      >
        {active && (
          <View style={gb.glow} pointerEvents="none" />
        )}
        <Text style={[gb.label, active && gb.labelActive]}>{label}</Text>
        {sublabel ? <Text style={gb.sublabel}>{sublabel}</Text> : null}
      </TouchableOpacity>
    </Animated.View>
  );
}

const gb = StyleSheet.create({
  btn: {
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: C.glass,
    borderWidth: 1, borderColor: C.glassBorder,
    overflow: "hidden",
    alignItems: "center",
    minWidth: 72,
    minHeight: 48,
  },
  btnActive: {
    backgroundColor: C.glassActive,
    borderColor: C.accent,
  },
  glow: {
    position: "absolute", inset: 0,
    backgroundColor: C.accentSoft,
    borderRadius: 14,
  },
  label:       { color: C.textSub, fontSize: 15, fontWeight: "600" },
  labelActive: { color: C.accent },
  sublabel:    { color: C.textDim, fontSize: 11, marginTop: 2 },
});

// ─── Section Header ───────────────────────────────────────────────────────────

function Section({ title, icon }: { title: string; icon: string }) {
  return (
    <View style={sec.row}>
      <Text style={sec.icon}>{icon}</Text>
      <Text style={sec.title}>{title}</Text>
    </View>
  );
}
const sec = StyleSheet.create({
  row:   { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 32, marginBottom: 6 },
  icon:  { fontSize: 16, opacity: 0.7 },
  title: { color: C.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase" },
});

// ─── Accessible Toggle Row ────────────────────────────────────────────────────

function ToggleRow({
  label, sublabel, value, onChange, vibration: vib,
}: { label: string; sublabel: string; value: boolean; onChange: (v: boolean) => void; vibration: boolean }) {
  return (
    <View
      style={tr.row}
      accessible
      accessibilityLabel={`${label}. ${sublabel}. Currently ${value ? "on" : "off"}.`}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <View style={{ flex: 1 }}>
        <Text style={tr.label}>{label}</Text>
        <Text style={tr.sub}>{sublabel}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={(v) => { hapticPress(vib); onChange(v); }}
        trackColor={{ false: "rgba(255,255,255,0.1)", true: C.accentSoft }}
        thumbColor={value ? C.accent : "rgba(238,244,255,0.35)"}
        ios_backgroundColor="rgba(255,255,255,0.1)"
      />
    </View>
  );
}

const tr = StyleSheet.create({
  row:   {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.glassBorder,
  },
  label: { color: C.text,    fontSize: 16, fontWeight: "600", marginBottom: 3 },
  sub:   { color: C.textSub, fontSize: 13, lineHeight: 18 },
});

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SettingsScreen({ visible, settings, onSave, onClose }: Props) {
  const [local,  setLocal]  = useState<Settings>(settings);
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  const slideY = useRef(new Animated.Value(800)).current;

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setLocal((prev) => ({ ...prev, [key]: value }));

  // Reset local state when modal opens + animate in
  useEffect(() => {
    if (visible) {
      setLocal(settings);
      Animated.spring(slideY, {
        toValue: 0, useNativeDriver: true, tension: 60, friction: 14,
      }).start();
    } else {
      slideY.setValue(800);
    }
  }, [visible]);

  // Load available system voices
  useEffect(() => {
    Speech.getAvailableVoicesAsync()
      .then((v) => setVoices(v))
      .catch(console.warn);
  }, []);

  const save = () => {
    onSave(local);
    hapticPress(true);
    AccessibilityInfo.announceForAccessibility("Settings saved.");
    onClose();
  };

  const dismiss = () => {
    hapticPress(local.vibration);
    onClose();
  };

  const englishVoices = voices
    .filter((v) => v.language?.startsWith("en"))
    .slice(0, 12);

  const fs = local.largeText ? 1.18 : 1; // font scale multiplier

  return (
    <Modal
      visible={visible}
      animationType="none"
      presentationStyle="overFullScreen"
      transparent
      statusBarTranslucent
      accessibilityViewIsModal
    >
      {/* ── Dimmed backdrop ── */}
      <View style={s.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close settings" />

        {/* ── Glass sheet ── */}
        <Animated.View style={[s.sheet, { transform: [{ translateY: slideY }] }]}>
          <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={s.sheetInner}>

            {/* Header */}
            <View style={s.header}>
              <View style={s.headerLeft}>
                <View style={s.headerDot} />
                <Text style={[s.headerTitle, { fontSize: 22 * fs }]}>Settings</Text>
              </View>
              <TouchableOpacity
                onPress={dismiss}
                style={s.closeBtn}
                accessibilityLabel="Close settings"
                accessibilityRole="button"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
                <Text style={s.closeIcon}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={s.scroll}
              contentContainerStyle={s.content}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >

              {/* ─── Step Length ─── */}
              <Section title="Your Step Length" icon="👣" />
              <Text style={[s.desc, { fontSize: 13 * fs }]}>
                Average is 0.80 m. Count 10 steps, measure the distance, divide by 10.
              </Text>

              <View style={s.inputRow}>
                <TextInput
                  style={[s.input, { fontSize: 22 * fs }]}
                  keyboardType="decimal-pad"
                  value={String(local.stepLengthM)}
                  onChangeText={(t) => {
                    const v = parseFloat(t);
                    if (!isNaN(v) && v > 0.3 && v < 1.5) update("stepLengthM", v);
                  }}
                  selectTextOnFocus
                  accessibilityLabel={`Step length, currently ${local.stepLengthM} metres`}
                  accessibilityHint="Enter your step length in metres"
                  returnKeyType="done"
                  placeholderTextColor={C.textDim}
                />
                <Text style={s.inputUnit}>m / step</Text>
              </View>

              <View style={s.presetRow}>
                {([0.68, 0.75, 0.80, 0.88, 0.95] as number[]).map((v) => (
                  <GlassBtn
                    key={v}
                    label={v.toFixed(2)}
                    active={local.stepLengthM === v}
                    onPress={() => update("stepLengthM", v)}
                    vibration={local.vibration}
                    accessLabel={`Set step length to ${v} metres`}
                  />
                ))}
              </View>

              {/* ─── Route Preference ─── */}
              <Section title="Route Preference" icon="🛤" />
              <Text style={[s.desc, { fontSize: 13 * fs }]}>
                Quiet routes favour residential streets and parks, minimising busy road crossings.
              </Text>
              <ToggleRow
                label="Prefer Quiet Route"
                sublabel="Avoid busy roads and noisy intersections"
                value={local.quietRoute}
                onChange={(v) => {
                  update("quietRoute", v);
                  AccessibilityInfo.announceForAccessibility(
                    v ? "Quiet route enabled." : "Quiet route disabled."
                  );
                }}
                vibration={local.vibration}
              />

              {/* ─── Voice & Speech ─── */}
              <Section title="Voice & Announcements" icon="🔊" />

              <Text style={[s.subhead, { fontSize: 14 * fs }]}>Speech Speed</Text>
              <View style={s.presetRow}>
                {([["Slow", 0.7], ["Normal", 0.88], ["Fast", 1.05]] as [string, number][]).map(([lbl, rate]) => (
                  <GlassBtn
                    key={lbl}
                    label={lbl}
                    active={local.voiceRate === rate}
                    onPress={() => {
                      update("voiceRate", rate);
                      Speech.speak(`Speed set to ${lbl}.`, { rate, language: "en-US" });
                    }}
                    vibration={local.vibration}
                    accessLabel={`Set speech speed to ${lbl}`}
                  />
                ))}
              </View>

              <ToggleRow
                label="Early Announcements"
                sublabel="Announce turns at 50 m instead of 30 m"
                value={local.announceEarly}
                onChange={(v) => {
                  update("announceEarly", v);
                  AccessibilityInfo.announceForAccessibility(
                    v ? "Early announcements on." : "Early announcements off."
                  );
                }}
                vibration={local.vibration}
              />

              <ToggleRow
                label="Vibration Feedback"
                sublabel="Haptic pulse at each turn instruction"
                value={local.vibration}
                onChange={(v) => update("vibration", v)}
                vibration={local.vibration}
              />

              {/* ─── Voice Selection ─── */}
              {englishVoices.length > 0 && (
                <>
                  <Text style={[s.subhead, { fontSize: 14 * fs, marginTop: 20 }]}>Voice</Text>
                  <View style={{ gap: 10, marginBottom: 4 }}>
                    {englishVoices.map((voice) => {
                      const active = local.voiceIdentifier === voice.identifier;
                      return (
                        <View
                          key={voice.identifier}
                          style={[s.voiceCard, active && s.voiceCardActive]}
                        >
                          <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
                          <TouchableOpacity
                            style={s.voiceCardInner}
                            onPress={() => {
                              hapticPress(local.vibration);
                              update("voiceIdentifier", voice.identifier);
                            }}
                            accessibilityLabel={`Select voice: ${voice.name}, ${voice.language}`}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: active }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={[s.voiceName, active && { color: C.accent }, { fontSize: 15 * fs }]}>
                                {voice.name}
                              </Text>
                              <Text style={s.voiceLang}>{voice.language}</Text>
                            </View>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={s.previewBtn}
                            onPress={() => {
                              hapticPress(local.vibration);
                              Speech.speak("GuideDog Navigate. Voice preview.", {
                                voice: voice.identifier,
                                rate: local.voiceRate,
                              });
                            }}
                            accessibilityLabel={`Preview ${voice.name} voice`}
                            accessibilityRole="button"
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Text style={s.previewText}>▶ Preview</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}

              {/* ─── Accessibility ─── */}
              <Section title="Accessibility" icon="♿" />

              <ToggleRow
                label="High Contrast Mode"
                sublabel="Increases text and UI contrast for low vision"
                value={local.highContrast}
                onChange={(v) => {
                  update("highContrast", v);
                  AccessibilityInfo.announceForAccessibility(
                    v ? "High contrast enabled." : "High contrast disabled."
                  );
                }}
                vibration={local.vibration}
              />

              <ToggleRow
                label="Large Text"
                sublabel="Increases font sizes throughout the app"
                value={local.largeText}
                onChange={(v) => {
                  update("largeText", v);
                  AccessibilityInfo.announceForAccessibility(
                    v ? "Large text enabled." : "Large text disabled."
                  );
                }}
                vibration={local.vibration}
              />

              <View style={{ height: 40 }} />

            </ScrollView>

            {/* Footer / Save */}
            <View style={s.footer}>
              <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
              <TouchableOpacity
                style={s.saveBtn}
                onPress={save}
                activeOpacity={0.85}
                accessibilityLabel="Save settings and close"
                accessibilityRole="button"
              >
                <View style={s.saveBtnGlow} pointerEvents="none" />
                <Text style={s.saveBtnText}>Save Settings</Text>
              </TouchableOpacity>
            </View>

          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(5,11,24,0.7)",
    justifyContent: "flex-end",
  },

  sheet: {
    height: "92%",
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    overflow: "hidden",
    borderWidth: 1, borderColor: C.glassBorder,
    borderBottomWidth: 0,
  },

  sheetInner: {
    flex: 1,
    backgroundColor: "rgba(8,16,34,0.85)",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 20 : 20,
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.glassBorder,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerDot:  {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: C.accent,
    shadowColor: C.accent, shadowRadius: 8, shadowOpacity: 1,
  },
  headerTitle: { color: C.text, fontWeight: "800" },

  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.glassBorder,
  },
  closeIcon: { color: C.textSub, fontSize: 15, fontWeight: "700", zIndex: 1 },

  scroll:  { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 4 },

  desc: { color: C.textSub, lineHeight: 19, marginBottom: 14 },

  subhead: { color: C.text, fontWeight: "700", marginBottom: 10 },

  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14,
  },
  input: {
    backgroundColor: C.glass,
    color: C.text,
    fontWeight: "700",
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1, borderColor: C.glassBorder,
    width: 110, textAlign: "center",
    minHeight: 52,
  },
  inputUnit: { color: C.textDim, fontSize: 14 },

  presetRow: {
    flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 8,
  },

  voiceCard: {
    borderRadius: 16, overflow: "hidden",
    borderWidth: 1, borderColor: C.glassBorder,
    flexDirection: "row", alignItems: "center",
  },
  voiceCardActive: { borderColor: C.accent },
  voiceCardInner:  { flex: 1, padding: 14 },
  voiceName:       { color: C.text, fontSize: 15, fontWeight: "700" },
  voiceLang:       { color: C.textDim, fontSize: 12, marginTop: 3 },
  previewBtn: {
    paddingHorizontal: 16, paddingVertical: 14,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: C.glassBorder,
    minHeight: 48, justifyContent: "center",
  },
  previewText: { color: C.accent, fontSize: 13, fontWeight: "700" },

  footer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: Platform.OS === "ios" ? 44 : 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.glassBorder,
    overflow: "hidden",
  },
  saveBtn: {
    backgroundColor: C.accentSoft,
    borderWidth: 1, borderColor: C.accent,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: "center",
    overflow: "hidden",
    minHeight: 56,
    justifyContent: "center",
  },
  saveBtnGlow: {
    position: "absolute", inset: 0,
    backgroundColor: C.glow,
  },
  saveBtnText: {
    color: C.accent,
    fontSize: 17, fontWeight: "800",
    letterSpacing: 0.4,
    zIndex: 1,
  },
});