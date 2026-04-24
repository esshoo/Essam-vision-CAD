const STORAGE_KEY = 'essam-cad-language';
const DEFAULT_LANGUAGE = 'en';
const SUPPORTED_LANGUAGES = ['en', 'ar'];
const dictionaries = new Map();

function normalizeLanguage(lang) {
  const raw = String(lang || '').toLowerCase();
  if (raw.startsWith('ar')) return 'ar';
  if (raw.startsWith('en')) return 'en';
  return DEFAULT_LANGUAGE;
}

function detectInitialLanguage() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return normalizeLanguage(stored);
  return normalizeLanguage(navigator.language || DEFAULT_LANGUAGE);
}

let currentLanguage = detectInitialLanguage();

async function loadLocale(lang) {
  const normalized = normalizeLanguage(lang);
  if (dictionaries.has(normalized)) return dictionaries.get(normalized);
  const url = new URL(`../../../locales/${normalized}.json`, import.meta.url).href;
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Failed to load locale ${normalized}: ${response.status}`);
  const data = await response.json();
  dictionaries.set(normalized, data || {});
  return data || {};
}

function deepGet(source, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((acc, part) => (acc && Object.prototype.hasOwnProperty.call(acc, part) ? acc[part] : undefined), source);
}

export function t(key, fallback = '') {
  const dict = dictionaries.get(currentLanguage) || {};
  const english = dictionaries.get('en') || {};
  const value = deepGet(dict, key);
  if (typeof value === 'string') return value;
  const fallbackValue = deepGet(english, key);
  if (typeof fallbackValue === 'string') return fallbackValue;
  return fallback || key;
}

function applyDocumentLanguage() {
  document.documentElement.lang = currentLanguage;
  document.documentElement.dir = currentLanguage === 'ar' ? 'rtl' : 'ltr';
  document.body?.setAttribute('data-lang', currentLanguage);
  document.title = t('app.title', document.title || 'Essam Vision CAD');
}

export async function initI18n() {
  await Promise.all(SUPPORTED_LANGUAGES.map((lang) => loadLocale(lang).catch(() => ({}))));
  applyDocumentLanguage();
  return currentLanguage;
}

export async function setLanguage(lang) {
  const normalized = normalizeLanguage(lang);
  await loadLocale(normalized).catch(() => ({}));
  currentLanguage = normalized;
  localStorage.setItem(STORAGE_KEY, normalized);
  applyDocumentLanguage();
  window.dispatchEvent(new CustomEvent('cad:language-changed', { detail: { language: normalized } }));
  return normalized;
}

export function getCurrentLanguage() {
  return currentLanguage;
}

export function getSupportedLanguages() {
  return SUPPORTED_LANGUAGES.slice();
}
