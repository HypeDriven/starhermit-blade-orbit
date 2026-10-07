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

/** StarHermit account strings (sign-in, invite, toasts, leaderboard line). `{name}` = display name, `{rank}` = board rank. */
export const ACCOUNT_STRINGS = {
  "en-US": {
    "signIn": "Sign in with StarHermit",
    "invite": "Invite a friend",
    "inviteCopied": "Invite link copied to the clipboard.",
    "inviteFailed": "Could not copy the invite link.",
    "offline": "Offline — progress is stored on this device.",
    "playingAs": "Playing as {name}",
    "synced": "progress synced",
    "saving": "saving…",
    "syncOff": "cloud sync unavailable",
    "signedOut": "Signed out of StarHermit — progress stays on this device.",
    "lbPosting": "Posting score to the leaderboard…",
    "lbRank": "Leaderboard rank: #{rank}",
    "lbPosted": "Score posted to the leaderboard.",
    "lbNotPosted": "Score not posted to the leaderboard."
  },
  "en-GB": {
    "signIn": "Sign in with StarHermit",
    "invite": "Invite a friend",
    "inviteCopied": "Invite link copied to the clipboard.",
    "inviteFailed": "Could not copy the invite link.",
    "offline": "Offline — progress is stored on this device.",
    "playingAs": "Playing as {name}",
    "synced": "progress synced",
    "saving": "saving…",
    "syncOff": "cloud sync unavailable",
    "signedOut": "Signed out of StarHermit — progress stays on this device.",
    "lbPosting": "Posting score to the leaderboard…",
    "lbRank": "Leaderboard rank: #{rank}",
    "lbPosted": "Score posted to the leaderboard.",
    "lbNotPosted": "Score not posted to the leaderboard."
  },
  "es-419": {
    "signIn": "Iniciar sesión con StarHermit",
    "invite": "Invitar a un amigo",
    "inviteCopied": "Enlace de invitación copiado al portapapeles.",
    "inviteFailed": "No se pudo copiar el enlace de invitación.",
    "offline": "Sin conexión: el progreso se guarda en este dispositivo.",
    "playingAs": "Jugando como {name}",
    "synced": "progreso sincronizado",
    "saving": "guardando…",
    "syncOff": "sincronización en la nube no disponible",
    "signedOut": "Sesión de StarHermit cerrada: el progreso se queda en este dispositivo.",
    "lbPosting": "Enviando la puntuación a la clasificación…",
    "lbRank": "Puesto en la clasificación: #{rank}",
    "lbPosted": "Puntuación enviada a la clasificación.",
    "lbNotPosted": "No se envió la puntuación a la clasificación."
  },
  "es-ES": {
    "signIn": "Iniciar sesión con StarHermit",
    "invite": "Invitar a un amigo",
    "inviteCopied": "Enlace de invitación copiado en el portapapeles.",
    "inviteFailed": "No se pudo copiar el enlace de invitación.",
    "offline": "Sin conexión: el progreso se guarda en este dispositivo.",
    "playingAs": "Jugando como {name}",
    "synced": "progreso sincronizado",
    "saving": "guardando…",
    "syncOff": "sincronización en la nube no disponible",
    "signedOut": "Sesión de StarHermit cerrada: el progreso se queda en este dispositivo.",
    "lbPosting": "Enviando la puntuación a la clasificación…",
    "lbRank": "Puesto en la clasificación: #{rank}",
    "lbPosted": "Puntuación enviada a la clasificación.",
    "lbNotPosted": "No se ha enviado la puntuación a la clasificación."
  },
  "de-DE": {
    "signIn": "Mit StarHermit anmelden",
    "invite": "Freund einladen",
    "inviteCopied": "Einladungslink in die Zwischenablage kopiert.",
    "inviteFailed": "Einladungslink konnte nicht kopiert werden.",
    "offline": "Offline – der Fortschritt wird auf diesem Gerät gespeichert.",
    "playingAs": "Du spielst als {name}",
    "synced": "Fortschritt synchronisiert",
    "saving": "wird gespeichert …",
    "syncOff": "Cloud-Synchronisierung nicht verfügbar",
    "signedOut": "Von StarHermit abgemeldet – der Fortschritt bleibt auf diesem Gerät.",
    "lbPosting": "Punktzahl wird an die Bestenliste gesendet …",
    "lbRank": "Platz in der Bestenliste: #{rank}",
    "lbPosted": "Punktzahl an die Bestenliste gesendet.",
    "lbNotPosted": "Punktzahl nicht an die Bestenliste gesendet."
  },
  "fr-FR": {
    "signIn": "Se connecter avec StarHermit",
    "invite": "Inviter un ami",
    "inviteCopied": "Lien d’invitation copié dans le presse-papiers.",
    "inviteFailed": "Impossible de copier le lien d’invitation.",
    "offline": "Hors ligne : la progression est enregistrée sur cet appareil.",
    "playingAs": "Vous jouez en tant que {name}",
    "synced": "progression synchronisée",
    "saving": "enregistrement…",
    "syncOff": "synchronisation cloud indisponible",
    "signedOut": "Déconnecté de StarHermit : la progression reste sur cet appareil.",
    "lbPosting": "Envoi du score au classement…",
    "lbRank": "Rang au classement : #{rank}",
    "lbPosted": "Score envoyé au classement.",
    "lbNotPosted": "Score non envoyé au classement."
  },
  "fr-CA": {
    "signIn": "Se connecter avec StarHermit",
    "invite": "Inviter un ami",
    "inviteCopied": "Lien d’invitation copié dans le presse-papiers.",
    "inviteFailed": "Impossible de copier le lien d’invitation.",
    "offline": "Hors ligne : la progression est enregistrée sur cet appareil.",
    "playingAs": "Vous jouez en tant que {name}",
    "synced": "progression synchronisée",
    "saving": "enregistrement…",
    "syncOff": "synchronisation infonuagique indisponible",
    "signedOut": "Déconnecté de StarHermit : la progression reste sur cet appareil.",
    "lbPosting": "Envoi du pointage au classement…",
    "lbRank": "Rang au classement : #{rank}",
    "lbPosted": "Pointage envoyé au classement.",
    "lbNotPosted": "Pointage non envoyé au classement."
  },
  "pt-BR": {
    "signIn": "Entrar com a StarHermit",
    "invite": "Convidar um amigo",
    "inviteCopied": "Link de convite copiado para a área de transferência.",
    "inviteFailed": "Não foi possível copiar o link de convite.",
    "offline": "Offline — o progresso fica salvo neste dispositivo.",
    "playingAs": "Jogando como {name}",
    "synced": "progresso sincronizado",
    "saving": "salvando…",
    "syncOff": "sincronização na nuvem indisponível",
    "signedOut": "Você saiu da StarHermit — o progresso continua neste dispositivo.",
    "lbPosting": "Enviando a pontuação para o ranking…",
    "lbRank": "Posição no ranking: #{rank}",
    "lbPosted": "Pontuação enviada para o ranking.",
    "lbNotPosted": "A pontuação não foi enviada para o ranking."
  },
  "it-IT": {
    "signIn": "Accedi con StarHermit",
    "invite": "Invita un amico",
    "inviteCopied": "Link di invito copiato negli appunti.",
    "inviteFailed": "Impossibile copiare il link di invito.",
    "offline": "Offline: i progressi sono salvati su questo dispositivo.",
    "playingAs": "Stai giocando come {name}",
    "synced": "progressi sincronizzati",
    "saving": "salvataggio…",
    "syncOff": "sincronizzazione cloud non disponibile",
    "signedOut": "Disconnesso da StarHermit: i progressi restano su questo dispositivo.",
    "lbPosting": "Invio del punteggio alla classifica…",
    "lbRank": "Posizione in classifica: #{rank}",
    "lbPosted": "Punteggio inviato alla classifica.",
    "lbNotPosted": "Punteggio non inviato alla classifica."
  }
};

export function accountText(locale) {
  return ACCOUNT_STRINGS[locale] || ACCOUNT_STRINGS['en-US'];
}
