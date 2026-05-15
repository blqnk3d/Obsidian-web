export const SETTINGS_KEY = 'obsidian-web-settings';

const DEFAULTS = {
  imageNaming: 'date-index',
  fontSize: 14,
};

export function getSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

export function updateSettings(partial) {
  const current = getSettings();
  const merged = { ...current, ...partial };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}
