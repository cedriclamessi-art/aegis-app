/**
 * EFFUSION - preset colorimetrique (eglise Effusion, Bussy-Saint-Georges)
 *
 * Charte : logo EFFUSION blanc sur noir, soulignement orange ;
 * gris beton pour le bracelet "pas de photo" (Charte droit a l'image).
 *
 * A CONFIRMER : les valeurs hex ci-dessous sont des estimations basees sur
 * la description de la charte. Les remplacer par celles du kit de marque
 * "Effusion" de Canva (Brand Kit > Couleurs) si elles different.
 */
const effusion = {
  black: '#0a0a0a',   // fond principal, logo
  white: '#ffffff',   // texte du logo, texte sur noir
  orange: {
    400: '#ff8a3d',
    500: '#f97316',   // soulignement du logo, boutons, liens (CTA)
    600: '#ea580c',   // survol
  },
  concrete: {
    300: '#c9c9c6',
    500: '#8d8d8a',   // gris beton : bracelet "pas de photo", bordures
    800: '#2b2b2a',   // surfaces sur fond noir
  },
  text: {
    onDark: '#ffffff',
    onLight: '#0a0a0a',
    muted: '#a3a3a0',
  },
};

module.exports = { effusion };
