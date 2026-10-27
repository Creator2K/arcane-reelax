import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const WEATHER_CYCLE_MS = 2 * 60 * 60 * 1000;

type WeatherDef = typeof schema.weather.$inferSelect;

export function cycleStartTime(): Date {
  return new Date(Math.floor(Date.now() / WEATHER_CYCLE_MS) * WEATHER_CYCLE_MS);
}

export function nextCycleStart(): Date {
  return new Date((Math.floor(Date.now() / WEATHER_CYCLE_MS) + 1) * WEATHER_CYCLE_MS);
}

let weatherCache: Map<string, WeatherDef> | null = null;
let weatherCacheAt = 0;

async function loadWeather(): Promise<Map<string, WeatherDef>> {
  if (!weatherCache || Date.now() - weatherCacheAt > 60_000) {
    const rows = await db.select().from(schema.weather).orderBy(schema.weather.orderIndex);
    weatherCache = new Map(rows.map((r) => [r.id, r]));
    weatherCacheAt = Date.now();
  }
  return weatherCache;
}

async function loadOverride(biomeId: string | null): Promise<string | null> {
  const key = biomeId ? `weatherOverride:${biomeId}` : 'weatherOverride:all';
  const row = (await db.select().from(schema.globalSettings).where(eq(schema.globalSettings.key, key)))[0];
  if (!row) return null;
  const value = row.value as { weatherId: string; setAt?: string };
  if (value.setAt && Date.now() - new Date(value.setAt).getTime() > 24 * 3600 * 1000) {
    // override expires after 24h
    await db.delete(schema.globalSettings).where(eq(schema.globalSettings.key, key));
    return null;
  }
  return value.weatherId ?? null;
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export async function getWeatherForBiome(biomeId: string): Promise<{ weather: WeatherDef; startedAt: Date; endsAt: Date }> {
  const defs = await loadWeather();
  const cycle = cycleStartTime();
  const cycleIndex = Math.floor(cycle.getTime() / WEATHER_CYCLE_MS);

  // admin override (all or per-biome) takes precedence
  const override = (await loadOverride(biomeId)) ?? (await loadOverride(null));
  if (override && defs.has(override)) {
    return { weather: defs.get(override)!, startedAt: cycle, endsAt: nextCycleStart() };
  }

  const seed = hashSeed(`${biomeId}:${cycleIndex}`);
  const candidates: WeatherDef[] = [];
  for (const w of defs.values()) {
    if ((w.excludedBiomeIds ?? []).includes(biomeId)) continue;
    candidates.push(w);
  }
  if (candidates.length === 0) {
    const clear = defs.get('clear')!;
    return { weather: clear, startedAt: cycle, endsAt: nextCycleStart() };
  }
  const totalWeight = candidates.reduce((s, w) => s + w.refreshWeight, 0);
  let roll = seed % totalWeight;
  let chosen: WeatherDef = candidates[0];
  for (const w of candidates) {
    if (roll < w.refreshWeight) {
      chosen = w;
      break;
    }
    roll -= w.refreshWeight;
  }
  return { weather: chosen, startedAt: cycle, endsAt: nextCycleStart() };
}
