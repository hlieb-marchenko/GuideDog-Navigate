import { useEffect, useState, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
} from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";

export default function App() {
  const [region, setRegion] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [path, setPath] = useState([]);
  const [destination, setDestination] = useState(null);
  const [input, setInput] = useState("");

  const locationSubscription = useRef(null);
  const mapRef = useRef(null);

  // GPS tracking
  useEffect(() => {
    let isMounted = true;

    (async () => {
      const { status } =
        await Location.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        setErrorMsg("Location permission denied");
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      if (!isMounted) return;

      const start = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };

      setRegion(start);
      setPath([{ latitude: start.latitude, longitude: start.longitude }]);

      locationSubscription.current =
        await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: 1000,
            distanceInterval: 1,
          },
          (loc) => {
            const point = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            };

            setRegion((prev) => ({
              ...prev,
              latitude: point.latitude,
              longitude: point.longitude,
            }));

            setPath((prev) => [...prev, point]);
          }
        );
    })();

    return () => {
      isMounted = false;
      locationSubscription.current?.remove();
    };
  }, []);

  const setDestinationFromInput = () => {
    const parts = input.split(",").map((p) => p.trim());
    if (parts.length !== 2) return;

    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lng)) return;

    const dest = { latitude: lat, longitude: lng };
    setDestination(dest);

    // Fit map to show destination and current location
    setTimeout(() => {
      if (mapRef.current && region) {
        mapRef.current.fitToCoordinates([region, dest], {
          edgePadding: { top: 80, right: 50, bottom: 80, left: 50 },
          animated: true,
        });
      }
    }, 300);
  };

  if (errorMsg) {
    return (
      <View style={styles.center}>
        <Text>{errorMsg}</Text>
      </View>
    );
  }

  if (!region) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text>Tracking your location…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.header}>
        <Text style={styles.headerText}>GuideDog Navigation (Demo)</Text>
      </View>

      {/* Destination input */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Destination lat,lng"
          value={input}
          onChangeText={setInput}
          keyboardType="numeric"
        />
        <TouchableOpacity style={styles.button} onPress={setDestinationFromInput}>
          <Text style={styles.buttonText}>Go</Text>
        </TouchableOpacity>
      </View>

      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        showsUserLocation
        followsUserLocation
      >
        {/* User path */}
        {path.length > 1 && (
          <Polyline coordinates={path} strokeColor="#1e90ff" strokeWidth={5} />
        )}

        {/* Destination line */}
        {destination && region && (
          <Polyline
            coordinates={[{ latitude: region.latitude, longitude: region.longitude }, destination]}
            strokeColor="green"
            strokeWidth={3}
            lineDashPattern={[10, 5]}
          />
        )}

        {/* Destination marker */}
        {destination && <Marker coordinate={destination} pinColor="red" />}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 60, backgroundColor: "#111", justifyContent: "center", paddingHorizontal: 16 },
  headerText: { color: "white", fontSize: 20, fontWeight: "600" },
  inputRow: { flexDirection: "row", padding: 8, backgroundColor: "#f2f2f2" },
  input: { flex: 1, backgroundColor: "white", paddingHorizontal: 10, borderRadius: 6 },
  button: { marginLeft: 8, backgroundColor: "#111", paddingHorizontal: 16, justifyContent: "center", borderRadius: 6 },
  buttonText: { color: "white", fontWeight: "600" },
  map: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
