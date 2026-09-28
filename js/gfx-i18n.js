/**
 * Blade Orbit — strings for the Settings panel's Graphics section, in every
 * supported locale. The locale comes from the browser's language list; unknown
 * locales fall back by language (fr-BE → fr-FR, es-MX → es-419) and then to en-US.
 */

const en = {
  graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})',
  low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra', medium: 'Medium',
  renderScale: 'Render scale', fromPreset: 'From preset ({tier})',
  shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade',
  antialias: 'Anti-aliasing', reflections: 'Reflections', particles: 'Particles', detail: 'Surface detail',
  off: 'Off', on: 'On', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Plain', detailed: 'Detailed',
  adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  postFailed: 'Post-processing is unavailable on this device; effects are rendered without it.',
  unknownGpu: 'unknown GPU',
  words: { noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion', bloom: 'bloom', reflections: 'reflections', noAA: 'no anti-aliasing' },
};

const es = {
  graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
  low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Media',
  renderScale: 'Escala de renderizado', fromPreset: 'Según el ajuste ({tier})',
  shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color',
  antialias: 'Antialiasing', reflections: 'Reflejos', particles: 'Partículas', detail: 'Detalle de superficies',
  off: 'No', on: 'Sí', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Detallado',
  adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
  postFailed: 'El posprocesado no está disponible en este dispositivo; los efectos se dibujan sin él.',
  unknownGpu: 'GPU desconocida',
  words: { noShadows: 'sin sombras', shadows: 'sombras', ao: 'oclusión ambiental', aoHigh: 'oclusión ambiental completa', bloom: 'resplandor', reflections: 'reflejos', noAA: 'sin antialiasing' },
};

const fr = {
  graphics: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {tier})',
  low: 'Basse', balanced: 'Équilibrée', high: 'Élevée', ultra: 'Ultra', medium: 'Moyenne',
  renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
  shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs',
  antialias: 'Anticrénelage', reflections: 'Reflets', particles: 'Particules', detail: 'Détail des surfaces',
  off: 'Désactivé', on: 'Activé', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé',
  adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
  postFailed: 'Le post-traitement est indisponible sur cet appareil ; le rendu se fait sans lui.',
  unknownGpu: 'GPU inconnu',
  words: { noShadows: 'sans ombres', shadows: 'ombres', ao: 'occlusion ambiante', aoHigh: 'occlusion ambiante complète', bloom: 'halo', reflections: 'reflets', noAA: 'sans anticrénelage' },
};

export const GFX_STRINGS = {
  'en-US': en,
  'en-GB': { ...en, grade: 'Colour grade' },
  'es-419': es,
  'es-ES': { ...es, renderScale: 'Escala de renderizado', antialias: 'Suavizado de bordes', words: { ...es.words, noAA: 'sin suavizado' } },
  'de-DE': {
    graphics: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
    low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra', medium: 'Mittel',
    renderScale: 'Renderskalierung', fromPreset: 'Laut Voreinstellung ({tier})',
    shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchteffekt', grade: 'Farbkorrektur',
    antialias: 'Kantenglättung', reflections: 'Spiegelungen', particles: 'Partikel', detail: 'Oberflächendetails',
    off: 'Aus', on: 'An', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Einfach', detailed: 'Detailliert',
    adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; es wird ohne sie gerendert.',
    unknownGpu: 'unbekannte GPU',
    words: { noShadows: 'keine Schatten', shadows: 'Schatten', ao: 'Umgebungsverdeckung', aoHigh: 'volle Umgebungsverdeckung', bloom: 'Leuchteffekt', reflections: 'Spiegelungen', noAA: 'keine Kantenglättung' },
  },
  'fr-FR': fr,
  'fr-CA': { ...fr, bloom: 'Éclat lumineux', words: { ...fr.words, bloom: 'éclat' } },
  'pt-BR': {
    graphics: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
    low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', medium: 'Média',
    renderScale: 'Escala de renderização', fromPreset: 'Da predefinição ({tier})',
    shadows: 'Sombras', ao: 'Oclusão de ambiente', bloom: 'Brilho', grade: 'Correção de cor',
    antialias: 'Antisserrilhamento', reflections: 'Reflexos', particles: 'Partículas', detail: 'Detalhe das superfícies',
    off: 'Desligado', on: 'Ligado', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simples', detailed: 'Detalhado',
    adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
    postFailed: 'O pós-processamento não está disponível neste dispositivo; a renderização é feita sem ele.',
    unknownGpu: 'GPU desconhecida',
    words: { noShadows: 'sem sombras', shadows: 'sombras', ao: 'oclusão de ambiente', aoHigh: 'oclusão de ambiente completa', bloom: 'brilho', reflections: 'reflexos', noAA: 'sem antisserrilhamento' },
  },
  'it-IT': {
    graphics: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
    low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra', medium: 'Media',
    renderScale: 'Scala di rendering', fromPreset: 'Dal preset ({tier})',
    shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore',
    antialias: 'Antialiasing', reflections: 'Riflessi', particles: 'Particelle', detail: 'Dettaglio superfici',
    off: 'No', on: 'Sì', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Semplice', detailed: 'Dettagliato',
    adaptive: 'Risoluzione adattiva', showFps: 'Mostra frequenza fotogrammi',
    postFailed: 'La post-elaborazione non è disponibile su questo dispositivo; il rendering avviene senza.',
    unknownGpu: 'GPU sconosciuta',
    words: { noShadows: 'nessuna ombra', shadows: 'ombre', ao: 'occlusione ambientale', aoHigh: 'occlusione ambientale completa', bloom: 'bagliore', reflections: 'riflessi', noAA: 'nessun antialiasing' },
  },
};

const BY_LANG = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' };

/** Pick the best supported locale for a list of BCP 47 tags. */
export function pickLocale(tags) {
  for (const raw of tags || []) {
    const tag = String(raw);
    const exact = Object.keys(GFX_STRINGS).find((k) => k.toLowerCase() === tag.toLowerCase());
    if (exact) return exact;
    const [lang, region] = tag.toLowerCase().split('-');
    if (lang === 'es' && region === 'es') return 'es-ES';
    if (lang === 'en' && region === 'gb') return 'en-GB';
    if (lang === 'fr' && region === 'ca') return 'fr-CA';
    if (BY_LANG[lang]) return BY_LANG[lang];
  }
  return 'en-US';
}

/** String lookup with `{name}` substitution. */
export function gfxText(locale) {
  const table = GFX_STRINGS[locale] || GFX_STRINGS['en-US'];
  const t = (key, vars) => String(table[key] ?? GFX_STRINGS['en-US'][key] ?? key)
    .replace(/\{(\w+)\}/g, (_, k) => (vars && k in vars ? vars[k] : ''));
  t.words = table.words;
  t.locale = locale;
  return t;
}
