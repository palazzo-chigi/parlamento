// Normalizzazione dei gruppi parlamentari (Camera e Senato usano sigle diverse)
// e palette di colori sobri. L'ordine va da sinistra a destra nell'emiciclo.
// Ogni gruppo ha un colore per lo stile HUD (neon su fondo scuro) e uno per lo stile Europarl (pieno, su fondo chiaro).

import { isEP } from './theme.js';

export const GROUPS = {
  avs:    { label: 'Alleanza Verdi e Sinistra',      color: '#8fe64a', ep: '#4c9a2a' },
  pd:     { label: 'Partito Democratico - IDP',      color: '#ff4d6d', ep: '#d6334a' },
  m5s:    { label: 'Movimento 5 Stelle',             color: '#ffd23f', ep: '#e0a800' },
  iv:     { label: 'Italia Viva - Il Centro',        color: '#ff7ad9', ep: '#c2408f' },
  azione: { label: 'Azione - PER - RE',              color: '#8f7bff', ep: '#6a4fc7' },
  aut:    { label: 'Autonomie (SVP-PATT, Cb)',       color: '#c2b280', ep: '#9c8a55' },
  misto:  { label: 'Gruppo Misto',                   color: '#9aa7b8', ep: '#8794a6' },
  altro:  { label: 'Altro',                          color: '#6b7a8c', ep: '#a3adba' },
  nm:     { label: 'Noi Moderati / Civici d\'Italia', color: '#5fe3c0', ep: '#1f9e89' },
  fi:     { label: 'Forza Italia - PPE',             color: '#3fb6ff', ep: '#2b8cd6' },
  lega:   { label: 'Lega - Salvini Premier',         color: '#2ee59d', ep: '#16855a' },
  fdi:    { label: 'Fratelli d\'Italia',              color: '#4c6fff', ep: '#1c3f94' },
};

export const ORDER = Object.keys(GROUPS);

export const vacantColor = () => (isEP() ? '#e3e7ed' : '#2a3444');
export const dimmedColor = () => (isEP() ? '#d3d9e2' : '#1d2533');

export function groupKey(sigla, nome) {
  const s = (sigla || nome || '').toLowerCase().trim();
  if (!s) return 'altro';
  if (s.startsWith('fdi')) return 'fdi';
  if (s.startsWith('pd')) return 'pd';
  if (s.startsWith('m5s')) return 'm5s';
  if (s.startsWith('lega') || s.startsWith('lsp')) return 'lega';
  if (s.startsWith('fi')) return 'fi';
  if (s.startsWith('az')) return 'azione';
  if (s.startsWith('avs')) return 'avs';
  if (s.startsWith('iv')) return 'iv';
  if (s.startsWith('nm') || s.startsWith("cd'i") || s.includes('noi moderati')) return 'nm';
  if (s.startsWith('aut')) return 'aut';
  if (s.startsWith('misto')) return 'misto';
  return 'altro';
}

export function groupColor(key) {
  const g = GROUPS[key] || GROUPS.altro;
  return isEP() ? g.ep : g.color;
}
