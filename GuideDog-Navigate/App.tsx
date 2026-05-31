// GuideDog Navigate — Visually Impaired Edition
// Build: npx expo run:ios (Terminal 2) after npx react-native start (Terminal 1)

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

import Mapbox from "@rnmapbox/maps";
import * as Location from "expo-location";
import * as Speech from "expo-speech";

import SettingsScreen, { DEFAULT_SETTINGS, Settings } from "./src/SettingsScreen";
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

// ─── Config ──────────────────────────────────────────────────────────────────

const GRAPHHOPPER_KEY = "";
const MAPBOX_TOKEN    = "";

// Simulator fallback — Frankfurt city centre
const FALLBACK_COORDS: Coords = { latitude: 50.1109, longitude: 8.6821 };

const ARRIVAL_RADIUS_M = 15;
const REROUTE_RADIUS_M = 50;

Mapbox.setAccessToken(MAPBOX_TOKEN);

const { width } = Dimensions.get("window");

// ─── Types ────────────────────────────────────────────────────────────────────

interface Coords {
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
}

interface Suggestion {
  place_id: string;
  display_name: string;
  lat: string;
  lon: string;
}

interface Instruction {
  text: string;
  distance: number;
  sign: number;
  interval: [number, number];
  points?: { lat: number; lon: number }[];
}

type AppState = "idle" | "routing" | "navigating" | "arrived";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function haversine(a: Coords, b: Coords): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}min`;
}

// Compute initial bearing between two coords (degrees)
function initialBearing(from: Coords, to: Coords): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLon = rad(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(rad(to.latitude));
  const x =
    Math.cos(rad(from.latitude)) * Math.sin(rad(to.latitude)) -
    Math.sin(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

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

  const bannerAnim  = useRef(new Animated.Value(0)).current;
  const settingsAnim = useRef(new Animated.Value(0)).current;

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
      setLocationError("Location permission denied. Using default location.");
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
      centerCoordinate: [coords.longitude, coords.latitude],
      heading: (coords.speed ?? 0) > 0.5 ? coords.heading ?? 0 : undefined,
      pitch: 60,
      zoomLevel: 18,
      animationDuration: animated ? 600 : 0,
    });
  };

  // ── Position update & turn announcement ───────────────────────────────────

  const onPositionUpdate = useCallback(
    (coords: Coords) => {
      if (appState !== "navigating" || !destination) return;

      const distToDest = haversine(coords, destination);

      // Arrival
      if (distToDest < ARRIVAL_RADIUS_M) {
        handleArrival();
        return;
      }

      // Off-route reroute
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

      // Check upcoming instructions
      const announceAt = settings.announceEarly ? 50 : 30;
      for (let i = instrIndexRef.current; i < instructions.length; i++) {
        const instr = instructions[i];
        if (announcedRef.current.has(i)) continue;

        // Estimate distance to this instruction point
        if (instr.distance < announceAt || i === instrIndexRef.current) {
          announcedRef.current.add(i);
          instrIndexRef.current = i + 1;
          setCurrentInstr(instructions[i + 1] ?? null);

          // Build and speak rich instruction async
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
    // Fetch OSM context in parallel
    const [crossing, streetName] = await Promise.all([
      fetchCrossingInfo(fromCoords.latitude, fromCoords.longitude),
      fetchStreetName(fromCoords.latitude, fromCoords.longitude),
    ]);

    // Get next street name if available
    const nextIdx = instrIndexRef.current;
    let nextStreetName: string | null = null;
    if (nextIdx < instructions.length) {
      const nextInstr = instructions[nextIdx];
      // Extract street name from GraphHopper text heuristically
      const match = nextInstr.text.match(/onto (.+)$/i);
      nextStreetName = match ? match[1] : null;
    }

    // Compute start bearing
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
      instrText: instr.text,
      sign: instr.sign,
      distanceM: instr.distance,
      stepLength: settings.stepLengthM,
      streetName,
      nextStreetName,
      crossing,
      isStart,
      startBearing,
      routeType: settings.quietRoute ? "quiet" : "normal",
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
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(text)}&format=json&limit=6&addressdetails=1`,
        { headers: { "User-Agent": "GuideDogNavigate/1.0", "Accept-Language": "en" } }
      );
      if (!res.ok) throw new Error();
      setSuggestions(await res.json());
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
    setQuery(item.display_name.split(",")[0]);
    setSuggestions([]);
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
          [
            currentLoc.longitude,
            currentLoc.latitude,
          ],
          [dest.longitude, dest.latitude],
        ],

        profile: "foot",
        instructions: true,
        points_encoded: false,
        locale: "en",
      };

      if (settings.quietRoute) {
        body["ch.disable"] = true;

        body.custom_model = {
          priority: [
            {
              if: "road_class == PRIMARY",
              multiply_by: "0.05",
            },
            {
              if: "road_class == SECONDARY",
              multiply_by: "0.2",
            },
            {
              if: "road_class == TERTIARY",
              multiply_by: "0.5",
            },
            {
              if:
                "road_class == RESIDENTIAL",
              multiply_by: "1.3",
            },
            {
              if:
                "road_environment == TUNNEL",
              multiply_by: "0.3",
            },
          ],
        };
      }

      const res = await fetch(
        `https://graphhopper.com/api/1/route?key=${GRAPHHOPPER_KEY}`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify(body),
        }
      );

      const data = await res.json();

      if (!data.paths?.length) {
        throw new Error("No route");
      }

      const path = data.paths[0];

      const coords =
        path.points.coordinates.map(
          (c: number[]) => [c[0], c[1]]
        );

      routeCoordsRef.current = coords;

      const parsed: Instruction[] =
        (path.instructions ?? []).map(
          (i: any) => ({
            text: i.text,
            distance: i.distance,
            sign: i.sign,
            interval: i.interval,
          })
        );

      setRoute({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: coords,
        },
        properties: {},
      });

      setDestination(dest);

      setRouteDistance(path.distance);
      setRouteTime(path.time);

      setInstructions(parsed);

      instrIndexRef.current = 0;
      announcedRef.current = new Set();

      setCurrentInstr(parsed[0] ?? null);

      setAppState("navigating");

      showBanner();

      if (parsed.length > 0) {
        await buildAndSpeakInstruction(
          parsed[0],
          currentLoc,
          true
        );
      }
    } catch (e) {
      console.error(e);

      speakInstruction(
        "Could not find a route.",
        settings.voiceRate,
        settings.voiceIdentifier
      );

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
    instrIndexRef.current = 0;
    reroutingRef.current = false;
    announcedRef.current = new Set();
    routeCoordsRef.current = [];
  };

  const repeatInstruction = () => {
    if (currentInstr) speakInstruction(currentInstr.text, settings.voiceRate, settings.voiceIdentifier);
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const isNavigating = appState === "navigating";
  const isArrived    = appState === "arrived";
  const showSearch   = appState === "idle" || appState === "routing";

  const bannerTranslateY = bannerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 0],
  });

  const stepsRemaining = metersToSteps(routeDistance, settings.stepLengthM);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

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
            <Mapbox.ShapeSource id="routeShadow" shape={route}>
              <Mapbox.LineLayer
                id="routeShadowLine"
                style={{ lineColor: "#000", lineWidth: 12, lineCap: "round", lineJoin: "round", lineOpacity: 0.3 }}
                layerIndex={1}
              />
            </Mapbox.ShapeSource>
            <Mapbox.ShapeSource id="route" shape={route}>
              <Mapbox.LineLayer
                id="routeLine"
                style={{
                  lineColor: settings.quietRoute ? "#4ADE80" : "#38BDF8",
                  lineWidth: 6,
                  lineCap: "round",
                  lineJoin: "round",
                }}
                layerIndex={2}
              />
            </Mapbox.ShapeSource>
          </>
        )}
      </Mapbox.MapView>

      {/* ── Location error ── */}
      {locationError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{locationError}</Text>
        </View>
      )}

      {/* ── Search panel ── */}
      {showSearch && (
        <View style={styles.searchPanel}>
          <View style={styles.searchRow}>
            <Text style={styles.searchIcon}>⌕</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Where to?"
              placeholderTextColor="#475569"
              value={query}
              onChangeText={onQueryChange}
              returnKeyType="search"
              onSubmitEditing={() => suggestions.length > 0 && selectSuggestion(suggestions[0])}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel="Destination search"
              accessibilityHint="Type your destination and select from the list"
            />
            {isLoadingSuggestions ? (
              <ActivityIndicator color="#38BDF8" style={{ marginRight: 16 }} />
            ) : query.length > 0 ? (
              <TouchableOpacity
                onPress={() => { setQuery(""); setSuggestions([]); }}
                style={styles.clearBtn}
                accessibilityLabel="Clear search"
              >
                <Text style={styles.clearBtnText}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {suggestions.length > 0 && (
            <FlatList
              data={suggestions}
              keyExtractor={(item) => item.place_id}
              keyboardShouldPersistTaps="handled"
              style={styles.suggestionList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => selectSuggestion(item)}
                  activeOpacity={0.7}
                  accessibilityLabel={item.display_name}
                  accessibilityRole="button"
                >
                  <Text style={styles.suggestionMain} numberOfLines={1}>
                    {item.display_name.split(",")[0]}
                  </Text>
                  <Text style={styles.suggestionSub} numberOfLines={1}>
                    {item.display_name.split(",").slice(1, 3).join(",")}
                  </Text>
                </TouchableOpacity>
              )}
            />
          )}

          {/* Quiet route badge */}
          {settings.quietRoute && (
            <View style={styles.quietBadge}>
              <Text style={styles.quietBadgeText}>🌿 Quiet Route Active</Text>
            </View>
          )}
        </View>
      )}

      {/* ── Loading overlay ── */}
      {isLoadingRoute && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#38BDF8" />
          <Text style={styles.loadingText}>
            {settings.quietRoute ? "Finding quietest route…" : "Finding best route…"}
          </Text>
        </View>
      )}

      {/* ── Status message (rerouting etc) ── */}
      {statusMsg && (
        <View style={styles.statusMsg}>
          <Text style={styles.statusMsgText}>{statusMsg}</Text>
        </View>
      )}

      {/* ── Turn-by-turn banner ── */}
      {(isNavigating || isArrived) && (
        <Animated.View style={[styles.navBanner, { transform: [{ translateY: bannerTranslateY }] }]}>
          {isArrived ? (
            <View style={styles.arrivedContent}>
              <Text style={styles.arrivedEmoji}>🎉</Text>
              <Text style={styles.arrivedTitle}>You have arrived!</Text>
              <Text style={styles.arrivedSub}>
                {stepsRemaining.toLocaleString()} steps walked
              </Text>
            </View>
          ) : currentInstr ? (
            <TouchableOpacity
              style={styles.instrContent}
              onPress={repeatInstruction}
              activeOpacity={0.85}
              accessibilityLabel={`Current instruction: ${currentInstr.text}. Tap to repeat.`}
              accessibilityRole="button"
            >
              <View style={[
                styles.turnIconBox,
                settings.quietRoute && styles.turnIconBoxQuiet,
              ]}>
                <Text style={styles.turnIconText}>{turnIcon(currentInstr.sign)}</Text>
              </View>
              <View style={styles.instrTextBox}>
                <Text style={styles.instrText} numberOfLines={3}>{currentInstr.text}</Text>
                <Text style={styles.instrDist}>
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
          {!isArrived && (
            <View>
              <Text style={styles.etaTime}>{formatDuration(routeTime)}</Text>
              <Text style={styles.etaDist}>
                {formatStepsAndMeters(routeDistance, settings.stepLengthM)}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.stopBtn}
            onPress={stopNavigation}
            accessibilityLabel="End route"
            accessibilityRole="button"
          >
            <Text style={styles.stopBtnText}>✕  End Route</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Top-right controls ── */}
      <View style={styles.topControls}>
        {/* Settings button */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => setShowSettings(true)}
          accessibilityLabel="Open settings"
          accessibilityRole="button"
        >
          <Text style={styles.controlIcon}>⚙</Text>
        </TouchableOpacity>

        {/* Recenter */}
        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => location && followUser(location, true)}
          accessibilityLabel="Re-center map on your location"
          accessibilityRole="button"
        >
          <Text style={styles.controlIcon}>◎</Text>
        </TouchableOpacity>
      </View>

      {/* ── Settings modal ── */}
      <SettingsScreen
        visible={showSettings}
        settings={settings}
        onSave={(s) => {
          setSettings(s);
          speakInstruction("Settings saved.", s.voiceRate, s.voiceIdentifier);
        }}
        onClose={() => setShowSettings(false)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0f1e" },
  map:  { flex: 1 },

  userDotOuter: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(56,189,248,0.2)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "rgba(56,189,248,0.5)",
  },
  userDotInner: { width: 14, height: 14, borderRadius: 7, backgroundColor: "#38BDF8" },

  destPin: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: "#F472B6", borderWidth: 3, borderColor: "white",
  },

  errorBanner: {
    position: "absolute", top: 60, alignSelf: "center",
    backgroundColor: "#7f1d1d", paddingHorizontal: 20, paddingVertical: 12,
    borderRadius: 12, maxWidth: width * 0.9,
  },
  errorText: { color: "#fca5a5", fontSize: 14, textAlign: "center" },

  searchPanel: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    alignSelf: "center",
    width: width * 0.82, // narrower to make room for top controls
    backgroundColor: "#0f172a",
    borderRadius: 20,
    shadowColor: "#000", shadowOpacity: 0.6, shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14, overflow: "hidden",
    borderWidth: 1, borderColor: "#1e293b",
  },
  searchRow:  { flexDirection: "row", alignItems: "center", paddingLeft: 16 },
  searchIcon: { color: "#475569", fontSize: 20, marginRight: 8 },
  searchInput: {
    flex: 1, color: "white", fontSize: 17,
    paddingVertical: 18, fontWeight: "500",
  },
  clearBtn:     { paddingHorizontal: 16, paddingVertical: 18 },
  clearBtnText: { color: "#475569", fontSize: 15 },

  suggestionList: { borderTopWidth: 1, borderTopColor: "#1e293b", maxHeight: 300 },
  suggestionItem: {
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: "#1e293b",
  },
  suggestionMain: { color: "#f1f5f9", fontSize: 16, fontWeight: "600", marginBottom: 3 },
  suggestionSub:  { color: "#475569", fontSize: 13 },

  quietBadge: {
    backgroundColor: "#052e16",
    paddingHorizontal: 16, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: "#1e293b",
  },
  quietBadgeText: { color: "#4ADE80", fontSize: 13, fontWeight: "600" },

  loadingOverlay: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(10,15,30,0.8)",
    alignItems: "center", justifyContent: "center", gap: 16,
  },
  loadingText: { color: "#94a3b8", fontSize: 16, fontWeight: "500" },

  statusMsg: {
    position: "absolute",
    bottom: 140,
    alignSelf: "center",
    backgroundColor: "#1e293b",
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 20,
  },
  statusMsgText: { color: "#94a3b8", fontSize: 14, fontWeight: "500" },

  navBanner: {
    position: "absolute",
    top: Platform.OS === "ios" ? 56 : 36,
    alignSelf: "center",
    width: width * 0.92,
    backgroundColor: "#0f172a",
    borderRadius: 22,
    shadowColor: "#38BDF8", shadowOpacity: 0.2,
    shadowRadius: 20, shadowOffset: { width: 0, height: 6 },
    elevation: 14, overflow: "hidden",
    borderWidth: 1, borderColor: "#1e293b",
  },
  instrContent: {
    flexDirection: "row", alignItems: "center",
    padding: 18, gap: 16,
  },
  turnIconBox: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: "#38BDF8",
    alignItems: "center", justifyContent: "center",
  },
  turnIconBoxQuiet: { backgroundColor: "#4ADE80" },
  turnIconText: { fontSize: 26, color: "#0a0f1e", fontWeight: "800" },
  instrTextBox: { flex: 1 },
  instrText: {
    color: "#f1f5f9", fontSize: 18, fontWeight: "700",
    lineHeight: 24, marginBottom: 5,
  },
  instrDist: { color: "#38BDF8", fontSize: 14, fontWeight: "600" },
  speakHint: { fontSize: 20, opacity: 0.4 },

  arrivedContent: { alignItems: "center", padding: 28, gap: 6 },
  arrivedEmoji: { fontSize: 40 },
  arrivedTitle: { color: "#f1f5f9", fontSize: 22, fontWeight: "800" },
  arrivedSub:   { color: "#64748b", fontSize: 14, marginTop: 4 },

  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#0f172a",
    paddingBottom: Platform.OS === "ios" ? 36 : 16,
    paddingTop: 18, paddingHorizontal: 24,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderTopWidth: 1, borderTopColor: "#1e293b",
  },
  etaTime: { color: "#f1f5f9", fontSize: 24, fontWeight: "800" },
  etaDist: { color: "#64748b", fontSize: 13, fontWeight: "500", marginTop: 3 },
  stopBtn: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 24, paddingVertical: 16,
    borderRadius: 50, borderWidth: 1, borderColor: "#334155",
  },
  stopBtnText: { color: "#f87171", fontSize: 15, fontWeight: "700" },

  topControls: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    right: 16,
    gap: 10,
  },
  controlBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "#0f172a",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.4,
    shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 8, borderWidth: 1, borderColor: "#1e293b",
  },
  controlIcon: { color: "#38BDF8", fontSize: 22 },
});