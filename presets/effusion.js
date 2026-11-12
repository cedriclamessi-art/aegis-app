/**
 * EFFUSION - preset colorimetrique (eglise Effusion, Bussy-Saint-Georges)
 *
 * Source : canevas de design "Serie REVIENS - Effusion" (couleurs reellement
 * utilisees dans la cover, la banniere web, la banniere YouTube et les fonds verts).
 * Logo EFFUSION : blanc/creme sur noir, soulignement orange.
 *
 * Note : le gris beton du bracelet "pas de photo" (Charte droit a l'image)
 * n'a pas de valeur definie ; `concrete.500` est repris de la palette de gris.
 */
const effusion = {
  // Fonds
  black: '#0B0B0B',       // fond principal
  charcoal: {
    900: '#141414',       // bandeaux, sol de decor
    800: '#1C1C1C',       // emplacement photo (cover)
    700: '#1E1E1E',       // emplacement photo (web, YouTube)
    600: '#2C2C2C',       // contours de decor
  },
  // Texte et traits
  cream: '#F4F1EA',       // "blanc" de la marque : titres, logo
  text: {
    primary: '#F4F1EA',
    soft: '#E0E0E0',      // paragraphes
    muted: '#BDBDBD',     // sous-titres, dates
    subtle: '#A8A8A8',
    placeholder: '#8A8A8A',
  },
  border: 'rgba(244, 241, 234, 0.25)',       // filets
  borderSubtle: 'rgba(244, 241, 234, 0.15)', // filets de navigation
  overlay: 'rgba(11, 11, 11, 0.55)',         // voile sur photo
  // Accent
  orange: {
    500: '#FF5A1F',       // logo, boutons (CTA), mot en script
    400: '#FF7A45',       // survol
  },
  // Etat "pas de photo" (bracelet)
  concrete: { 500: '#8A8A8A' },
};

const fonts = {
  display: "'Anton', sans-serif",             // titres (REVIENS, EFFUSION)
  body: "'Archivo', sans-serif",              // texte, boutons, navigation
  script: "'Permanent Marker', cursive",      // mot d'accent manuscrit ("attendu.")
};

module.exports = { effusion, fonts };
