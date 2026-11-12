/**
 * AEGIS SUPREMATIE - preset colorimetrique
 * Source unique des couleurs : consommee par tailwind.config.js
 * et exposee en variables CSS (--aegis-*) dans src/styles/globals.css.
 */
const aegis = {
  // Fonds (du plus sombre au plus clair)
  bg: {
    base: '#0f172a',     // fond de page
    surface: '#1e293b',  // cartes, panneaux
    elevated: '#334155', // survols, menus
  },
  // Texte
  text: {
    primary: '#e2e8f0',
    secondary: '#94a3b8',
    muted: '#64748b',
  },
  // Bordures
  border: {
    subtle: '#334155',
    strong: '#475569',
  },
  // Couleur de marque (indigo)
  brand: {
    50: '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
  },
  // Accent secondaire (violet) pour degrades avec la marque
  accent: {
    400: '#a78bfa',
    500: '#8b5cf6',
    600: '#7c3aed',
  },
  // Etats
  success: { 400: '#34d399', 500: '#10b981', 600: '#059669' },
  warning: { 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
  danger: { 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48' },
  info: { 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7' },
  // Series de graphiques (recharts)
  chart: ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#0ea5e9', '#8b5cf6'],
};

/** Aplatit l'objet en variables CSS : { '--aegis-brand-500': '#6366f1', ... } */
function toCssVars(obj = aegis, prefix = '--aegis') {
  const vars = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => { vars[`${prefix}-${key}-${i + 1}`] = v; });
    } else if (typeof value === 'object') {
      Object.assign(vars, toCssVars(value, `${prefix}-${key}`));
    } else {
      vars[`${prefix}-${key}`] = value;
    }
  }
  return vars;
}

module.exports = { aegis, toCssVars };
