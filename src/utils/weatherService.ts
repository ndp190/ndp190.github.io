// Weather service for Bien Hoa, Vietnam using Open-Meteo API (free, no API key needed)
// Coordinates: 10.9574° N, 106.8426° E

const BIEN_HOA_LAT = 10.9574;
const BIEN_HOA_LON = 106.8426;

export interface WeatherData {
  temperature: number;
  weatherCode: number;
  isDay: boolean;
  description: string;
}

// WMO Weather interpretation codes
// https://open-meteo.com/en/docs
const weatherDescriptions: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export async function fetchWeather(): Promise<WeatherData | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${BIEN_HOA_LAT}&longitude=${BIEN_HOA_LON}&current=temperature_2m,weather_code,is_day&timezone=Asia%2FHo_Chi_Minh`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Weather fetch failed');
    }

    const data = await response.json();
    const current = data.current;

    return {
      temperature: Math.round(current.temperature_2m),
      weatherCode: current.weather_code,
      isDay: current.is_day === 1,
      description: weatherDescriptions[current.weather_code] || 'Unknown',
    };
  } catch (error) {
    console.error('Failed to fetch weather:', error);
    return null;
  }
}

export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

export function getWeatherType(code: number): WeatherType {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  if (code >= 51) return 'rain';
  return 'clear';
}
