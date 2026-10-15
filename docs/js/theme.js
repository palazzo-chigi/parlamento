// Stile grafico del sito: 'hud' (sci-fi scuro, predefinito) o 'ep' (istituzionale, ispirato al Parlamento europeo).
// La scelta è salvata nel browser; l'attributo data-theme su <html> viene impostato già nell'<head> per evitare sfarfallii.

export const THEMES = { hud: 'HUD', ep: 'Europarl' };
const KEY = 'emiciclo-theme';
const listeners = new Set();

export function getTheme() {
  const t = document.documentElement.dataset.theme;
  return t in THEMES ? t : 'hud';
}

export const isEP = () => getTheme() === 'ep';

export function setTheme(t) {
  if (!(t in THEMES) || t === getTheme()) return;
  document.documentElement.dataset.theme = t;
  document.documentElement.setAttribute('data-bs-theme', t === 'ep' ? 'light' : 'dark');
  try { localStorage.setItem(KEY, t); } catch { /* storage non disponibile */ }
  syncSwitch();
  listeners.forEach((fn) => fn(t));
}

export function onThemeChange(fn) { listeners.add(fn); }

function syncSwitch() {
  document.querySelectorAll('input[name=theme]').forEach((r) => { r.checked = r.value === getTheme(); });
}

// collega il selettore di stile nella navbar
document.querySelectorAll('input[name=theme]').forEach((r) => r.addEventListener('change', () => setTheme(r.value)));
syncSwitch();
