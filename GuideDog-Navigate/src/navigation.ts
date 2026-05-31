// src/navigation.ts

import * as Speech from "expo-speech";

// ─────────────────────────────────────────────────────────────
// Step Length
// ─────────────────────────────────────────────────────────────

export const DEFAULT_STEP_LENGTH_M = 0.8;

export function metersToSteps(
  meters: number,
  stepLength: number = DEFAULT_STEP_LENGTH_M
): number {
  return Math.round(meters / stepLength);
}

export function formatStepsAndMeters(
  meters: number,
  stepLength: number = DEFAULT_STEP_LENGTH_M
): string {
  const steps = metersToSteps(meters, stepLength);

  if (meters < 5) return "a few steps";

  if (meters < 50) {
    return `${steps} steps (${Math.round(meters)} m)`;
  }

  return `${steps} steps (${(meters / 1000).toFixed(1)} km)`;
}

// ─────────────────────────────────────────────────────────────
// Turn Helpers
// ─────────────────────────────────────────────────────────────

export function signToDirection(sign: number): string {
  switch (sign) {
    case -3: return "sharp left";
    case -2: return "left";
    case -1: return "slightly left";
    case  0: return "straight ahead";
    case  1: return "slightly right";
    case  2: return "right";
    case  3: return "sharp right";
    case  4: return "destination";
    case  6: return "roundabout";
    default: return "straight ahead";
  }
}

export function turnIcon(sign: number): string {
  switch (sign) {
    case -3: return "↰";
    case -2: return "←";
    case -1: return "↖";
    case  0: return "↑";
    case  1: return "↗";
    case  2: return "→";
    case  3: return "↱";
    case  4: return "✓";
    case  6: return "⟳";
    default: return "↑";
  }
}

// ─────────────────────────────────────────────────────────────
// Crossing Info
// ─────────────────────────────────────────────────────────────

export interface CrossingInfo {
  hasCrossing: boolean;
  isSignalised: boolean;
  hasTrafficLight: boolean;
}

const crossingCache = new Map<string, CrossingInfo>();
const streetCache   = new Map<string, string | null>();

function cacheKey(lat: number, lon: number) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export async function fetchCrossingInfo(lat: number, lon: number): Promise<CrossingInfo> {
  const key = cacheKey(lat, lon);
  if (crossingCache.has(key)) return crossingCache.get(key)!;

  const query = `
    [out:json][timeout:5];
    (
      node["highway"="crossing"](around:30,${lat},${lon});
      node["highway"="traffic_signals"](around:30,${lat},${lon});
    );
    out body;
  `;

  try {
    const res  = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data = await res.json();
    const elements = data.elements ?? [];

    const hasTrafficLight = elements.some((e: any) => e.tags?.highway === "traffic_signals");
    const crossings       = elements.filter((e: any) => e.tags?.highway === "crossing");

    const result: CrossingInfo = {
      hasCrossing:   crossings.length > 0,
      isSignalised:  crossings.some((e: any) => e.tags?.crossing === "traffic_signals"),
      hasTrafficLight,
    };
    crossingCache.set(key, result);
    return result;
  } catch {
    return { hasCrossing: false, isSignalised: false, hasTrafficLight: false };
  }
}

export async function fetchStreetName(lat: number, lon: number): Promise<string | null> {
  const key = cacheKey(lat, lon);
  if (streetCache.has(key)) return streetCache.get(key)!;

  const query = `
    [out:json][timeout:5];
    way["highway"](around:20,${lat},${lon});
    out body;
  `;

  try {
    const res    = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data   = await res.json();
    const named  = (data.elements ?? []).find((e: any) => e.tags?.name);
    const result = named?.tags?.name ?? null;
    streetCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Compass
// ─────────────────────────────────────────────────────────────

export function bearingToCardinal(bearing: number): string {
  const dirs = ["north","northeast","east","southeast","south","southwest","west","northwest"];
  return dirs[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

// ─────────────────────────────────────────────────────────────
// Voice Instructions
// ─────────────────────────────────────────────────────────────

export interface VoiceContext {
  instrText: string;
  sign: number;
  distanceM: number;
  stepLength: number;
  streetName: string | null;
  nextStreetName: string | null;
  crossing: CrossingInfo;
  isStart: boolean;
  startBearing: number | null;
  routeType: "quiet" | "normal";
}

export async function buildVoiceInstruction(ctx: VoiceContext): Promise<string> {
  const steps     = metersToSteps(ctx.distanceM, ctx.stepLength);
  const direction = signToDirection(ctx.sign);

  let text = "";

  if (ctx.isStart && ctx.startBearing !== null) {
    text += `Start heading ${bearingToCardinal(ctx.startBearing)}. `;
  }

  if (!ctx.isStart) {
    text += `In ${steps} steps, turn ${direction}`;
  } else {
    text += `Continue ${direction}`;
  }

  if (ctx.nextStreetName) {
    text += ` onto ${ctx.nextStreetName}`;
  }

  text += ".";

  if (ctx.crossing.hasCrossing) {
    if (ctx.crossing.hasTrafficLight || ctx.crossing.isSignalised) {
      text += " Signalised crossing ahead. Wait for the green signal.";
    } else {
      text += " Crossing ahead. Listen carefully for traffic.";
    }
  }

  return text;
}

// ─────────────────────────────────────────────────────────────
// Speech
// ─────────────────────────────────────────────────────────────

export async function speakInstruction(text: string, rate: number = 0.88, voice?: string) {
  await Speech.stop();
  Speech.speak(text, { rate, voice, language: "en-US", pitch: 1.0 });
}