// GuideDog Navigate — Liquid Glass Edition
// Accessibility-first walking navigator for visually impaired users

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import { BlurView }   from "expo-blur";
import Mapbox          from "@rnmapbox/maps";
import * as Location   from "expo-location";
import * as Speech     from "expo-speech";
import AsyncStorage    from "@react-native-async-storage/async-storage";

import SettingsScreen, {
  DEFAULT_SETTINGS,
  Settings,
} from "./src/SettingsScreen";

import {
  bearingToCardinal,
  buildVoiceInstruction,
  fetchCrossingInfo,
  fetchStreetName,
  formatStepsAndMeters,
  metersToSteps,
  speakInstruction,
  turnIcon,
} from "./src/navigation";

// ─── Config ───────────────────────────────────────────────────────────────────

const GRAPHHOPPER_KEY = process.env.GRAPHHOPPER_KEY;
const MAPBOX_TOKEN    = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const SETTINGS_KEY    = "@guidedog_settings";

const FALLBACK_COORDS: Coords = { latitude: 50.1109, longitude: 8.6821 };
const ARRIVAL_RADIUS_M  = 15;
const REROUTE_RADIUS_M  = 50;

Mapbox.setAccessToken(MAPBOX_TOKEN);

const { width } = Dimensions.get("window");

// ─── Colour Tokens ────────────────────────────────────────────────────────────

const C = {
  bg:          "#050b18",
  glass:       "rgba(255,255,255,0.06)",
  glassBorder: "rgba(255,255,255,0.13)",
  glassHover:  "rgba(99,210,255,0.12)",
  accent:      "#63D2FF",
  accentSoft:  "rgba(99,210,255,0.22)",
  accentGreen: "#6EE7B7",
  text:        "#EEF4FF",
  textSub:     "rgba(238,244,255,0.50)",
  textDim:     "rgba(238,244,255,0.28)",
  glow:        "rgba(99,210,255,0.18)",
  danger:      "#FF6B6B",
  dangerSoft:  "rgba(255,107,107,0.18)",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Coords {
  latitude:  number;
  longitude: number;
  heading?:  number | null;
  speed?:    number | null;
}

interface Suggestion {
  place_id:     string;
  display_name: string;
  lat:          string;
  lon:          string;
}

interface Instruction {
  text:     string;
  distance: number;
  sign:     number;
  interval: [number, number];
}

type AppState = "idle" | "routing" | "navigating" | "arrived";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversine(a: Coords, b: Coords): number {
  const R   = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude  - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

function initialBearing(from: Coords, to: Coords): number {
  const rad  = (d: number) => (d * Math.PI) / 180;
  const dLon = rad(to.longitude - from.longitude);
  const y    = Math.sin(dLon) * Math.cos(rad(to.latitude));
  const x    =
    Math.cos(rad(from.latitude)) * Math.sin(rad(to.latitude)) -
    Math.sin(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ─── Animated Glass Pill Button (top controls) ────────────────────────────────

function ControlBtn({
  icon, label, onPress, vibration: vib, badge,
}: {
  icon: string; label: string; onPress: () => void; vibration: boolean; badge?: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn  = () => Animated.spring(scale, { toValue: 0.88, useNativeDriver: true, speed: 50 }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 30 }).start();

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        onPress={() => { if (vib) Vibration.vibrate(30); onPress(); }}
        onPressIn={pressIn}
        onPressOut={pressOut}
        activeOpacity={1}
        style={cb.btn}
        accessibilityLabel={label}
        accessibilityRole="button"
      >
        <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
        <Text style={cb.icon}>{icon}</Text>
        {badge && <View style={cb.badge}><Text style={cb.badgeText}>{badge}</Text></View>}
      </TouchableOpacity>
    </Animated.View>
  );
}

const cb = StyleSheet.create({
  btn: {
    width: 52, height: 52, borderRadius: 26,
    overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.glassBorder,
  },
  icon:      { color: C.accent, fontSize: 22, zIndex: 1 },
  badge: {
    position: "absolute", top: 6, right: 6,
    backgroundColor: C.accent,
    borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1,
  },
  badgeText: { color: C.bg, fontSize: 9, fontWeight: "800" },
});

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const cameraRef      = useRef<Mapbox.Camera>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instrIndexRef  = useRef(0);
  const reroutingRef   = useRef(false);
  const locationRef    = useRef<Coords | null>(null);
  const routeCoordsRef = useRef<number[][]>([]);
  const announcedRef   = useRef<Set<number>>(new Set());

  const bannerAnim = useRef(new Animated.Value(0)).current;

  const [appState,             setAppState]             = useState<AppState>("idle");
  const [location,             setLocation]             = useState<Coords | null>(null);
  const [query,                setQuery]                = useState("");
  const [suggestions,          setSuggestions]          = useState<Suggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isLoadingRoute,       setIsLoadingRoute]       = useState(false);
  const [locationError,        setLocationError]        = useState<string | null>(null);
  const [route,                setRoute]                = useState<any | null>(null);
  const [destination,          setDestination]          = useState<Coords | null>(null);
  const [routeDistance,        setRouteDistance]        = useState(0);
  const [routeTime,            setRouteTime]            = useState(0);
  const [instructions,         setInstructions]         = useState<Instruction[]>([]);
  const [currentInstr,         setCurrentInstr]         = useState<Instruction | null>(null);
  const [settings,             setSettings]             = useState<Settings>(DEFAULT_SETTINGS);
  const [showSettings,         setShowSettings]         = useState(false);
  const [statusMsg,            setStatusMsg]            = useState<string | null>(null);

  // ── Persist & load settings ───────────────────────────────────────────────

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((raw) => { if (raw) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) }); })
      .catch(console.warn);
  }, []);

  const handleSaveSettings = (s: Settings) => {
    setSettings(s);
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s)).catch(console.warn);
    speakInstruction("Settings saved.", s.voiceRate, s.voiceIdentifier);
  };

  // ── Location ──────────────────────────────────────────────────────────────

  useEffect(() => {
    initLocation();
    return () => {
      locationSubRef.current?.remove();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const applyLocation = (coords: Coords, animated: boolean) => {
    locationRef.current = coords;
    setLocation(coords);
    followUser(coords, animated);
  };

  const initLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setLocationError("Location permission denied. Using Frankfurt as fallback.");
      applyLocation(FALLBACK_COORDS, false);
      return;
    }
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      applyLocation(loc.coords, false);
    } catch {
      applyLocation(FALLBACK_COORDS, false);
    }

    try {
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 800 },
        (loc) => {
          applyLocation(loc.coords, true);
          onPositionUpdate(loc.coords);
        }
      );
      locationSubRef.current = sub;
    } catch (e) {
      console.warn("[Location] watch failed:", e);
    }
  };

  // ── Camera ────────────────────────────────────────────────────────────────

  const followUser = (coords: Coords, animated: boolean) => {
    cameraRef.current?.setCamera({
      centerCoordinate:  [coords.longitude, coords.latitude],
      heading:           (coords.speed ?? 0) > 0.5 ? coords.heading ?? 0 : undefined,
      pitch:             60,
      zoomLevel:         18,
      animationDuration: animated ? 600 : 0,
    });
  };

  // ── Position update & turn announcement ───────────────────────────────────

  const onPositionUpdate = useCallback(
    (coords: Coords) => {
      if (appState !== "navigating" || !destination) return;

      const distToDest = haversine(coords, destination);

      if (distToDest < ARRIVAL_RADIUS_M) {
        handleArrival();
        return;
      }

      if (
        !reroutingRef.current &&
        instrIndexRef.current >= instructions.length &&
        distToDest > REROUTE_RADIUS_M
      ) {
        reroutingRef.current = true;
        setStatusMsg("Recalculating route…");
        speakInstruction("Off route. Recalculating.", settings.voiceRate, settings.voiceIdentifier);
        buildRoute(destination).finally(() => {
          reroutingRef.current = false;
          setStatusMsg(null);
        });
        return;
      }

      const announceAt = settings.announceEarly ? 50 : 30;
      for (let i = instrIndexRef.current; i < instructions.length; i++) {
        const instr = instructions[i];
        if (announcedRef.current.has(i)) continue;
        if (instr.distance < announceAt || i === instrIndexRef.current) {
          announcedRef.current.add(i);
          instrIndexRef.current = i + 1;
          setCurrentInstr(instructions[i + 1] ?? null);
          buildAndSpeakInstruction(instr, coords, i === 0).catch(console.warn);
          if (settings.vibration) Vibration.vibrate(120);
          break;
        }
      }
    },
    [appState, destination, instructions, settings]
  );

  // ── Rich instruction builder ───────────────────────────────────────────────

  const buildAndSpeakInstruction = async (
    instr: Instruction,
    fromCoords: Coords,
    isStart: boolean
  ) => {
    const [crossing, streetName] = await Promise.all([
      fetchCrossingInfo(fromCoords.latitude, fromCoords.longitude),
      fetchStreetName(fromCoords.latitude, fromCoords.longitude),
    ]);

    const nextIdx = instrIndexRef.current;
    let nextStreetName: string | null = null;
    if (nextIdx < instructions.length) {
      const match = instructions[nextIdx].text.match(/onto (.+)$/i);
      nextStreetName = match ? match[1] : null;
    }

    let startBearing: number | null = null;
    if (isStart && routeCoordsRef.current.length >= 2) {
      const [lon1, lat1] = routeCoordsRef.current[0];
      const [lon2, lat2] = routeCoordsRef.current[1];
      startBearing = initialBearing(
        { latitude: lat1, longitude: lon1 },
        { latitude: lat2, longitude: lon2 }
      );
    }

    const voiceText = await buildVoiceInstruction({
      instrText:     instr.text,
      sign:          instr.sign,
      distanceM:     instr.distance,
      stepLength:    settings.stepLengthM,
      streetName,
      nextStreetName,
      crossing,
      isStart,
      startBearing,
      routeType:     settings.quietRoute ? "quiet" : "normal",
    });

    await speakInstruction(voiceText, settings.voiceRate, settings.voiceIdentifier);
  };

  // ── Arrival ───────────────────────────────────────────────────────────────

  const handleArrival = () => {
    setAppState("arrived");
    setCurrentInstr(null);
    const steps = metersToSteps(routeDistance, settings.stepLengthM);
    speakInstruction(
      `You have arrived at your destination! You walked approximately ${steps} steps.`,
      settings.voiceRate, settings.voiceIdentifier
    );
    if (settings.vibration) Vibration.vibrate([0, 250, 150, 250, 150, 400]);
    AccessibilityInfo.announceForAccessibility("You have arrived at your destination!");
    showBanner();
  };

  // ── Banner ────────────────────────────────────────────────────────────────

  const showBanner = () =>
    Animated.spring(bannerAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }).start();

  const hideBanner = () =>
    Animated.timing(bannerAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();

  // ── Search ────────────────────────────────────────────────────────────────

  const onQueryChange = (text: string) => {
    setQuery(text);
    setSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.length < 3) { setIsLoadingSuggestions(false); return; }
    setIsLoadingSuggestions(true);
    debounceRef.current = setTimeout(() => fetchSuggestions(text), 400);
  };

  const fetchSuggestions = async (text: string) => {
    try {
      const loc = locationRef.current;
      const viewbox = loc
        ? `&viewbox=${loc.longitude - 0.5},${loc.latitude + 0.5},${loc.longitude + 0.5},${loc.latitude - 0.5}&bounded=0`
        : "";
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=6&addressdetails=1${viewbox}`,
        { headers: { "User-Agent": "GuideDogNavigate/2.0", "Accept-Language": "en" } }
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSuggestions(data);
      if (data.length > 0) {
        AccessibilityInfo.announceForAccessibility(`${data.length} results found.`);
      }
    } catch {
      setSuggestions([]);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const selectSuggestion = (item: Suggestion) => {
    Keyboard.dismiss();
    if (!locationRef.current) {
      speakInstruction("Waiting for your location. Please try again.", settings.voiceRate, settings.voiceIdentifier);
      return;
    }
    const name = item.display_name.split(",")[0];
    setQuery(name);
    setSuggestions([]);
    if (settings.vibration) Vibration.vibrate(60);
    speakInstruction(`Routing to ${name}.`, settings.voiceRate, settings.voiceIdentifier);
    buildRoute({ latitude: parseFloat(item.lat), longitude: parseFloat(item.lon) });
  };

  // ── Route ─────────────────────────────────────────────────────────────────

  const buildRoute = async (dest: Coords) => {
    const currentLoc = locationRef.current;
    if (!currentLoc) return;

    setIsLoadingRoute(true);
    setAppState("routing");

    try {
      const body: any = {
        points: [
          [currentLoc.longitude, currentLoc.latitude],
          [dest.longitude,       dest.latitude],
        ],
        profile:          "foot",
        instructions:     true,
        points_encoded:   false,
        locale:           "en",
      };

      if (settings.quietRoute) {
        body["ch.disable"]  = true;
        body.custom_model   = {
          priority: [
            { if: "road_class == PRIMARY",     multiply_by: "0.05" },
            { if: "road_class == SECONDARY",   multiply_by: "0.2"  },
            { if: "road_class == TERTIARY",    multiply_by: "0.5"  },
            { if: "road_class == RESIDENTIAL", multiply_by: "1.3"  },
            { if: "road_environment == TUNNEL",multiply_by: "0.3"  },
          ],
        };
      }

      const res  = await fetch(
        `https://graphhopper.com/api/1/route?key=${GRAPHHOPPER_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      const data = await res.json();

      if (!data.paths?.length) throw new Error("No route");

      const path   = data.paths[0];
      const coords = path.points.coordinates.map((c: number[]) => [c[0], c[1]]);
      routeCoordsRef.current = coords;

      const parsed: Instruction[] = (path.instructions ?? []).map((i: any) => ({
        text:     i.text,
        distance: i.distance,
        sign:     i.sign,
        interval: i.interval,
      }));

      setRoute({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: {},
      });

      setDestination(dest);
      setRouteDistance(path.distance);
      setRouteTime(path.time);
      setInstructions(parsed);

      instrIndexRef.current   = 0;
      announcedRef.current    = new Set();
      setCurrentInstr(parsed[0] ?? null);
      setAppState("navigating");
      showBanner();

      if (parsed.length > 0) {
        await buildAndSpeakInstruction(parsed[0], currentLoc, true);
      }
    } catch (e) {
      console.error(e);
      speakInstruction("Could not find a route. Please try again.", settings.voiceRate, settings.voiceIdentifier);
      setAppState("idle");
    } finally {
      setIsLoadingRoute(false);
    }
  };

  // ── Stop ──────────────────────────────────────────────────────────────────

  const stopNavigation = () => {
    hideBanner();
    Speech.stop();
    setAppState("idle");
    setRoute(null);
    setDestination(null);
    setInstructions([]);
    setCurrentInstr(null);
    setRouteDistance(0);
    setRouteTime(0);
    setQuery("");
    setStatusMsg(null);
    instrIndexRef.current  = 0;
    reroutingRef.current   = false;
    announcedRef.current   = new Set();
    routeCoordsRef.current = [];
    if (settings.vibration) Vibration.vibrate(80);
    AccessibilityInfo.announceForAccessibility("Navigation stopped.");
  };

  const repeatInstruction = () => {
    if (currentInstr) {
      if (settings.vibration) Vibration.vibrate(40);
      speakInstruction(currentInstr.text, settings.voiceRate, settings.voiceIdentifier);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const isNavigating = appState === "navigating";
  const isArrived    = appState === "arrived";
  const showSearch   = appState === "idle" || appState === "routing";

  const bannerTranslateY = bannerAnim.interpolate({
    inputRange: [0, 1], outputRange: [-200, 0],
  });

  const stepsRemaining = metersToSteps(routeDistance, settings.stepLengthM);
  const fs             = settings.largeText ? 1.18 : 1;

  // Route line colour: green for quiet, blue for normal
  const routeColour = settings.quietRoute ? C.accentGreen : C.accent;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* ── Map ── */}
      <Mapbox.MapView
        style={styles.map}
        styleURL={Mapbox.StyleURL.Dark}
        logoEnabled={false}
        compassEnabled={false}
        attributionEnabled={false}
      >
        <Mapbox.Camera ref={cameraRef} zoomLevel={15} pitch={60} />

        {location && (
          <Mapbox.PointAnnotation id="user" coordinate={[location.longitude, location.latitude]}>
            <View style={styles.userDotOuter}>
              <View style={styles.userDotInner} />
            </View>
          </Mapbox.PointAnnotation>
        )}

        {destination && (
          <Mapbox.PointAnnotation id="dest" coordinate={[destination.longitude, destination.latitude]}>
            <View style={styles.destPin} />
          </Mapbox.PointAnnotation>
        )}

        {route && (
          <>
            {/* Shadow */}
            <Mapbox.ShapeSource id="routeShadow" shape={route}>
              <Mapbox.LineLayer
                id="routeShadowLine"
                style={{ lineColor: "#000", lineWidth: 14, lineCap: "round", lineJoin: "round", lineOpacity: 0.35 }}
                layerIndex={1}
              />
            </Mapbox.ShapeSource>
            {/* Glow */}
            <Mapbox.ShapeSource id="routeGlow" shape={route}>
              <Mapbox.LineLayer
                id="routeGlowLine"
                style={{ lineColor: routeColour, lineWidth: 14, lineCap: "round", lineJoin: "round", lineOpacity: 0.18 }}
                layerIndex={2}
              />
            </Mapbox.ShapeSource>
            {/* Main */}
            <Mapbox.ShapeSource id="route" shape={route}>
              <Mapbox.LineLayer
                id="routeLine"
                style={{ lineColor: routeColour, lineWidth: 5, lineCap: "round", lineJoin: "round" }}
                layerIndex={3}
              />
            </Mapbox.ShapeSource>
          </>
        )}
      </Mapbox.MapView>

      {/* ── Location error ── */}
      {locationError && (
        <View style={styles.errorBanner}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <Text style={[styles.errorText, { fontSize: 14 * fs }]}>{locationError}</Text>
        </View>
      )}

      {/* ── Search panel ── */}
      {showSearch && (
        <View style={styles.searchPanel}>
          <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />

          <View style={styles.searchRow}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              style={[styles.searchInput, { fontSize: 17 * fs }]}
              placeholder="Where to?"
              placeholderTextColor={C.textDim}
              value={query}
              onChangeText={onQueryChange}
              returnKeyType="search"
              onSubmitEditing={() => suggestions.length > 0 && selectSuggestion(suggestions[0])}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel="Destination search field"
              accessibilityHint="Type your destination then select from the list below"
              clearButtonMode="while-editing"
            />
            {isLoadingSuggestions && (
              <ActivityIndicator color={C.accent} style={{ marginRight: 16 }} />
            )}
            {!isLoadingSuggestions && query.length > 0 && (
              <TouchableOpacity
                onPress={() => { setQuery(""); setSuggestions([]); }}
                style={styles.clearBtn}
                accessibilityLabel="Clear search"
                accessibilityRole="button"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.clearBtnText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {suggestions.length > 0 && (
            <FlatList
              data={suggestions}
              keyExtractor={(item) => item.place_id}
              keyboardShouldPersistTaps="handled"
              style={styles.suggestionList}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => selectSuggestion(item)}
                  activeOpacity={0.7}
                  accessibilityLabel={`Result ${index + 1}: ${item.display_name}`}
                  accessibilityRole="button"
                  accessibilityHint="Double-tap to navigate here"
                >
                  <Text style={[styles.suggestionMain, { fontSize: 16 * fs }]} numberOfLines={1}>
                    {item.display_name.split(",")[0]}
                  </Text>
                  <Text style={[styles.suggestionSub, { fontSize: 13 * fs }]} numberOfLines={1}>
                    {item.display_name.split(",").slice(1, 3).join(",")}
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}

          {settings.quietRoute && (
            <View style={styles.quietBadge}>
              <Text style={[styles.quietBadgeText, { fontSize: 13 * fs }]}>🌿 Quiet Route Active</Text>
            </View>
          )}
        </View>
      )}

      {/* ── Loading overlay ── */}
      {isLoadingRoute && (
        <View style={styles.loadingOverlay}>
          <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={[styles.loadingText, { fontSize: 16 * fs }]}>
            {settings.quietRoute ? "Finding quietest route…" : "Finding best route…"}
          </Text>
        </View>
      )}

      {/* ── Status message (rerouting etc) ── */}
      {statusMsg && (
        <View style={styles.statusMsg}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <Text style={[styles.statusMsgText, { fontSize: 14 * fs }]}>{statusMsg}</Text>
        </View>
      )}

      {/* ── Turn-by-turn banner ── */}
      {(isNavigating || isArrived) && (
        <Animated.View style={[styles.navBanner, { transform: [{ translateY: bannerTranslateY }] }]}>
          <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.navBannerBorder} />

          {isArrived ? (
            <View style={styles.arrivedContent} accessible accessibilityLiveRegion="assertive">
              <Text style={styles.arrivedEmoji}>🎉</Text>
              <Text style={[styles.arrivedTitle, { fontSize: 22 * fs }]}>You have arrived!</Text>
              <Text style={[styles.arrivedSub, { fontSize: 14 * fs }]}>
                {stepsRemaining.toLocaleString()} steps walked
              </Text>
            </View>
          ) : currentInstr ? (
            <TouchableOpacity
              style={styles.instrContent}
              onPress={repeatInstruction}
              activeOpacity={0.85}
              accessibilityLabel={`${currentInstr.text}. Distance: ${formatStepsAndMeters(currentInstr.distance, settings.stepLengthM)}. Double-tap to repeat.`}
              accessibilityRole="button"
              accessibilityLiveRegion="assertive"
            >
              <View style={[styles.turnIconBox, settings.quietRoute && styles.turnIconBoxQuiet]}>
                <Text style={styles.turnIconText}>{turnIcon(currentInstr.sign)}</Text>
              </View>
              <View style={styles.instrTextBox}>
                <Text style={[styles.instrText, { fontSize: 18 * fs }]} numberOfLines={3}>
                  {currentInstr.text}
                </Text>
                <Text style={[styles.instrDist, { fontSize: 14 * fs }]}>
                  {formatStepsAndMeters(currentInstr.distance, settings.stepLengthM)}
                </Text>
              </View>
              <Text style={styles.speakHint}>🔊</Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>
      )}

      {/* ── Bottom bar ── */}
      {(isNavigating || isArrived) && (
        <View style={styles.bottomBar}>
          <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
          {!isArrived && (
            <View>
              <Text style={[styles.etaTime, { fontSize: 24 * fs }]} accessibilityLabel={`Estimated time: ${formatDuration(routeTime)}`}>
                {formatDuration(routeTime)}
              </Text>
              <Text style={[styles.etaDist, { fontSize: 13 * fs }]}>
                {formatStepsAndMeters(routeDistance, settings.stepLengthM)}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.stopBtn}
            onPress={stopNavigation}
            accessibilityLabel="End navigation"
            accessibilityRole="button"
            accessibilityHint="Double-tap to stop the current route"
          >
            <Text style={[styles.stopBtnText, { fontSize: 15 * fs }]}>✕  End Route</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Top-right controls ── */}
      <View style={styles.topControls}>
        <ControlBtn
          icon="⚙"
          label="Open settings"
          onPress={() => setShowSettings(true)}
          vibration={settings.vibration}
        />
        <ControlBtn
          icon="◎"
          label="Re-center map on your location"
          onPress={() => location && followUser(location, true)}
          vibration={settings.vibration}
        />
        {isNavigating && (
          <ControlBtn
            icon="🔊"
            label="Repeat last instruction"
            onPress={repeatInstruction}
            vibration={settings.vibration}
          />
        )}
      </View>

      {/* ── Settings modal ── */}
      <SettingsScreen
        visible={showSettings}
        settings={settings}
        onSave={handleSaveSettings}
        onClose={() => setShowSettings(false)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  map:  { flex: 1 },

  // User location dot
  userDotOuter: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: "rgba(99,210,255,0.18)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "rgba(99,210,255,0.5)",
    shadowColor: C.accent, shadowRadius: 10, shadowOpacity: 0.6,
  },
  userDotInner: { width: 14, height: 14, borderRadius: 7, backgroundColor: C.accent },

  // Destination pin
  destPin: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: "#F472B6",
    borderWidth: 3, borderColor: "white",
    shadowColor: "#F472B6", shadowRadius: 8, shadowOpacity: 0.8,
  },

  // Error banner
  errorBanner: {
    position: "absolute", top: 60, alignSelf: "center",
    overflow: "hidden",
    borderRadius: 14, maxWidth: width * 0.9,
    borderWidth: 1, borderColor: "rgba(255,107,107,0.3)",
  },
  errorText: {
    color: "#fca5a5", paddingHorizontal: 20, paddingVertical: 12,
    textAlign: "center", zIndex: 1,
  },

  // Search panel (glass card)
  searchPanel: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    alignSelf: "center",
    width: width * 0.82,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1, borderColor: C.glassBorder,
    shadowColor: C.accent, shadowOpacity: 0.08, shadowRadius: 30,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  searchRow:  { flexDirection: "row", alignItems: "center", paddingLeft: 16, zIndex: 1 },
  searchIcon: { color: C.textSub, fontSize: 20, marginRight: 8 },
  searchInput: {
    flex: 1, color: C.text,
    paddingVertical: 18, fontWeight: "500",
  },
  clearBtn:     { paddingHorizontal: 16, paddingVertical: 18 },
  clearBtnText: { color: C.textSub, fontSize: 15 },

  suggestionList: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.glassBorder, maxHeight: 300, zIndex: 1,
  },
  suggestionItem: {
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.glassBorder,
    minHeight: 56,
  },
  suggestionMain: { color: C.text, fontWeight: "600", marginBottom: 3 },
  suggestionSub:  { color: C.textSub },

  quietBadge: {
    backgroundColor: "rgba(110,231,183,0.12)",
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.glassBorder,
  },
  quietBadgeText: { color: C.accentGreen, fontWeight: "600" },

  // Loading overlay
  loadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    overflow: "hidden",
    alignItems: "center", justifyContent: "center", gap: 16,
  },
  loadingText: { color: C.textSub, fontWeight: "500", zIndex: 1 },

  // Status msg (rerouting pill)
  statusMsg: {
    position: "absolute", bottom: 140, alignSelf: "center",
    overflow: "hidden",
    borderRadius: 22,
    borderWidth: 1, borderColor: C.glassBorder,
  },
  statusMsgText: { color: C.textSub, fontWeight: "500", paddingHorizontal: 20, paddingVertical: 10, zIndex: 1 },

  // Navigation banner
  navBanner: {
    position: "absolute",
    top: Platform.OS === "ios" ? 56 : 36,
    alignSelf: "center",
    width: width * 0.92,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1, borderColor: C.glassBorder,
    shadowColor: C.accent, shadowOpacity: 0.15, shadowRadius: 24, shadowOffset: { width: 0, height: 6 },
    elevation: 14,
  },
  navBannerBorder: {
    position: "absolute", top: 0, left: 0, right: 0, height: 1,
    backgroundColor: "rgba(255,255,255,0.15)",
  },

  instrContent: {
    flexDirection: "row", alignItems: "center",
    padding: 18, gap: 16, zIndex: 1,
  },
  turnIconBox: {
    width: 60, height: 60, borderRadius: 18,
    backgroundColor: C.accentSoft,
    borderWidth: 1, borderColor: C.accent,
    alignItems: "center", justifyContent: "center",
    shadowColor: C.accent, shadowRadius: 10, shadowOpacity: 0.5,
  },
  turnIconBoxQuiet: {
    backgroundColor: "rgba(110,231,183,0.2)",
    borderColor: C.accentGreen,
    shadowColor: C.accentGreen,
  },
  turnIconText: { fontSize: 28, color: C.accent, fontWeight: "800" },
  instrTextBox: { flex: 1 },
  instrText:    { color: C.text, fontWeight: "700", lineHeight: 24, marginBottom: 5 },
  instrDist:    { color: C.accent, fontWeight: "600" },
  speakHint:    { fontSize: 20, opacity: 0.4 },

  arrivedContent: { alignItems: "center", padding: 28, gap: 6, zIndex: 1 },
  arrivedEmoji:   { fontSize: 40 },
  arrivedTitle:   { color: C.text, fontWeight: "800" },
  arrivedSub:     { color: C.textSub, marginTop: 4 },

  // Bottom bar
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    overflow: "hidden",
    paddingBottom: Platform.OS === "ios" ? 36 : 16,
    paddingTop: 18, paddingHorizontal: 24,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.glassBorder,
  },
  etaTime: { color: C.text, fontWeight: "800", zIndex: 1 },
  etaDist: { color: C.textSub, fontWeight: "500", marginTop: 3, zIndex: 1 },
  stopBtn: {
    backgroundColor: C.dangerSoft,
    paddingHorizontal: 24, paddingVertical: 16,
    borderRadius: 50,
    borderWidth: 1, borderColor: "rgba(255,107,107,0.4)",
    zIndex: 1,
  },
  stopBtnText: { color: C.danger, fontWeight: "700" },

  // Top controls
  topControls: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    right: 14,
    gap: 10,
  },
});