import {
  generateTabs,
  isArgInvalid,
  getCurrentCmdArry,
  checkRedirect,
  checkThemeSwitch,
} from '../utils/funcs';

describe('generateTabs', () => {
  it('returns base tabs when no argument provided', () => {
    const result = generateTabs();
    expect(result).toBe('\xA0\xA0');
  });

  it('returns base tabs when 0 is provided', () => {
    const result = generateTabs(0);
    expect(result).toBe('\xA0\xA0');
  });

  it('returns correct number of tabs', () => {
    const result = generateTabs(3);
    expect(result).toBe('\xA0\xA0\xA0\xA0\xA0');
  });
});

describe('isArgInvalid', () => {
  it('returns true when action does not match', () => {
    const result = isArgInvalid(['set', 'dark'], 'go', ['dark', 'light']);
    expect(result).toBe(true);
  });

  it('returns true when option is not in options array', () => {
    const result = isArgInvalid(['set', 'blue'], 'set', ['dark', 'light']);
    expect(result).toBe(true);
  });

  it('returns true when arg length is more than 2', () => {
    const result = isArgInvalid(['set', 'dark', 'extra'], 'set', ['dark', 'light']);
    expect(result).toBe(true);
  });

  it('returns false when all conditions are valid', () => {
    const result = isArgInvalid(['set', 'dark'], 'set', ['dark', 'light']);
    expect(result).toBe(false);
  });
});

describe('getCurrentCmdArry', () => {
  it('splits command into array', () => {
    const result = getCurrentCmdArry(['themes set dark', 'help']);
    expect(result).toEqual(['themes', 'set', 'dark']);
  });

  it('trims whitespace', () => {
    const result = getCurrentCmdArry(['  help  ', 'about']);
    expect(result).toEqual(['help']);
  });

  it('handles single command', () => {
    const result = getCurrentCmdArry(['about']);
    expect(result).toEqual(['about']);
  });
});

describe('checkRedirect', () => {
  it('returns true for valid redirect command', () => {
    const result = checkRedirect(true, ['projects', 'go', '1'], 'projects');
    expect(result).toBe(true);
  });

  it('returns false when not rerendered', () => {
    const result = checkRedirect(false, ['projects', 'go', '1'], 'projects');
    expect(result).toBe(false);
  });

  it('returns false when command does not match', () => {
    const result = checkRedirect(true, ['socials', 'go', '1'], 'projects');
    expect(result).toBe(false);
  });

  it('returns false when action is not go', () => {
    const result = checkRedirect(true, ['projects', 'set', '1'], 'projects');
    expect(result).toBe(false);
  });

  it('returns false for invalid id', () => {
    const result = checkRedirect(true, ['projects', 'go', '5'], 'projects');
    expect(result).toBe(false);
  });
});

describe('checkThemeSwitch', () => {
  const themes = ['dark', 'light', 'blue-matrix'];

  it('returns true for valid theme switch', () => {
    const result = checkThemeSwitch(true, ['themes', 'set', 'dark'], themes);
    expect(result).toBe(true);
  });

  it('returns false when not rerendered', () => {
    const result = checkThemeSwitch(false, ['themes', 'set', 'dark'], themes);
    expect(result).toBe(false);
  });

  it('returns false when command is not themes', () => {
    const result = checkThemeSwitch(true, ['about', 'set', 'dark'], themes);
    expect(result).toBe(false);
  });

  it('returns false when action is not set', () => {
    const result = checkThemeSwitch(true, ['themes', 'go', 'dark'], themes);
    expect(result).toBe(false);
  });

  it('returns false for invalid theme', () => {
    const result = checkThemeSwitch(true, ['themes', 'set', 'invalid'], themes);
    expect(result).toBe(false);
  });
});
