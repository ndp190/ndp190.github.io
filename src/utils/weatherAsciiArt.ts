import { WeatherType } from './weatherService';

// ASCII art for different weather conditions
// Day versions
const sunnyDay = `
       \\   |   /
         .---.
      - (     ) -
         \`---'
       /   |   \\
    __/         \\__
`;

const cloudyDay = `
         .--.
      .-(    ).
     (___.__)__)
        .--.
     .-(    ).
    (___.__)__)
`;

const rainyDay = `
         .--.
      .-(    ).
     (___.__)__)
      ' ' ' ' '
     ' ' ' ' '
      ' ' ' ' '
`;

const stormDay = `
         .--.
      .-(    ).
     (___.__)__)
      /_  /_  /
        /  / _/
      /_    /
`;

const foggyDay = `
    _ - _ - _ - _
   _ - _ - _ - _ -
  - _ - _ - _ - _
    _ - _ - _ - _
   _ - _ - _ - _ -
  - _ - _ - _ - _
`;

// Night versions
const clearNight = `
          *    .  *
       .        *
    *    *  .
         .    *  .
      .   *
    *   .    *    .
       *  .    *
`;

const cloudyNight = `
    *    .-.      *
      .-(   )-.  .
   * (___.__)__)
        .-.   *   .
  .   -(   )-.
     (___.__)__)  *
`;

const rainyNight = `
    *    .-.      .
      .-(   )-.
     (___.__)__)
   *  ' ' ' ' '   *
     ' ' ' ' '  .
      ' ' ' ' '
`;

const stormNight = `
    *    .-.      .
      .-(   )-.  *
     (___.__)__)
      /_  /_  /
   *    /  / _/  .
      /_    /
`;

const foggyNight = `
  * _ - _ - _ - _
   _ - _ - * - _ -
  - _ - _ - _ - _ *
    _ - _ - _ - _
   _ - * - _ - _ -
  - _ - _ - _ - _
`;

export function getWeatherAsciiArt(weatherType: WeatherType, isDay: boolean): string {
  if (isDay) {
    switch (weatherType) {
      case 'clear': return sunnyDay;
      case 'cloudy': return cloudyDay;
      case 'rain': return rainyDay;
      case 'storm': return stormDay;
      case 'fog': return foggyDay;
      default: return sunnyDay;
    }
  } else {
    switch (weatherType) {
      case 'clear': return clearNight;
      case 'cloudy': return cloudyNight;
      case 'rain': return rainyNight;
      case 'storm': return stormNight;
      case 'fog': return foggyNight;
      default: return clearNight;
    }
  }
}

// Default/loading ASCII art
export const loadingArt = `
      .  *  .
   *    .    *
     . _|_ .
   *   /|\\   *
      / | \\
     *  .  *
  Loading weather...
`;
