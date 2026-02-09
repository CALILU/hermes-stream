// Configuracion de la API base (siempre usa rutas relativas para aprovechar el proxy)
export const API_BASE = '';

// Clave de localStorage para cache de caratulas
export const CACHE_KEY = 'hermes_posters_cache';

// Paginacion
export const LOAD_MORE_COUNT = 50;

// Alfabeto para filtro A-Z
export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Mapeo de generos a emoticonos
export const genreEmojis = {
  'Accion': '\u{1F4A5}',
  'Action': '\u{1F4A5}',
  'Aventura': '\u{1F9ED}',
  'Adventure': '\u{1F9ED}',
  'Animacion': '\u{2728}',
  'Animation': '\u{2728}',
  'Comedia': '\u{1F602}',
  'Comedy': '\u{1F602}',
  'Crimen': '\u{1F52A}',
  'Crime': '\u{1F52A}',
  'Documental': '\u{1F3A5}',
  'Documentary': '\u{1F3A5}',
  'Drama': '\u{1F3AD}',
  'Familia': '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}',
  'Family': '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}',
  'Fantasia': '\u{1F9D9}\u{200D}\u{2642}\u{FE0F}',
  'Fantasy': '\u{1F9D9}\u{200D}\u{2642}\u{FE0F}',
  'Historia': '\u{1F4DC}',
  'History': '\u{1F4DC}',
  'Terror': '\u{1F47B}',
  'Horror': '\u{1F47B}',
  'Musica': '\u{1F3B5}',
  'Music': '\u{1F3B5}',
  'Misterio': '\u{1F50D}',
  'Mystery': '\u{1F50D}',
  'Romance': '\u{1F495}',
  'Ciencia ficcion': '\u{1F680}',
  'Science Fiction': '\u{1F680}',
  'Pelicula de TV': '\u{1F4FA}',
  'TV Movie': '\u{1F4FA}',
  'Suspense': '\u{1F630}',
  'Thriller': '\u{1F630}',
  'Belica': '\u{2694}\u{FE0F}',
  'Guerra': '\u{2694}\u{FE0F}',
  'War': '\u{2694}\u{FE0F}',
  'Western': '\u{1F920}',
  // Generos especificos de Series
  'Accion y Aventura': '\u{1F4A5}',
  'Action & Adventure': '\u{1F4A5}',
  'Ciencia ficcion y Fantasia': '\u{1F680}',
  'Sci-Fi & Fantasy': '\u{1F680}',
  'Infantil': '\u{1F9D2}',
  'Kids': '\u{1F9D2}',
  'Noticias': '\u{1F4F0}',
  'News': '\u{1F4F0}',
  'Reality': '\u{1F4F7}',
  'Telenovela': '\u{1F494}',
  'Soap': '\u{1F494}',
  'Talk Show': '\u{1F3A4}',
  'Talk': '\u{1F3A4}',
  'Belica y Politica': '\u{2694}\u{FE0F}',
  'War & Politics': '\u{2694}\u{FE0F}'
};

// Configuracion de estados de peticiones (colores y labels)
export const STATUS_CONFIG = {
  pending: {
    label: 'Pendiente',
    emoji: '\u{23F3}',
    badgeBg: 'bg-amber-700/40',
    badgeText: 'text-amber-300',
    selectBg: 'bg-amber-600',
    filterBg: 'bg-amber-900/50',
    filterRing: 'ring-amber-500',
    cardBg: 'bg-amber-900/20',
    cardBorder: 'border-amber-800/50'
  },
  downloading: {
    label: 'Descargando',
    emoji: '\u{2B07}\u{FE0F}',
    badgeBg: 'bg-blue-700/40',
    badgeText: 'text-blue-300',
    selectBg: 'bg-blue-600',
    filterBg: 'bg-blue-900/50',
    filterRing: 'ring-blue-500',
    cardBg: 'bg-blue-900/20',
    cardBorder: 'border-blue-800/50'
  },
  downloaded: {
    label: 'Descargada',
    emoji: '\u{2705}',
    badgeBg: 'bg-green-700/40',
    badgeText: 'text-green-300',
    selectBg: 'bg-green-600',
    filterBg: 'bg-green-900/50',
    filterRing: 'ring-green-500',
    cardBg: 'bg-green-900/20',
    cardBorder: 'border-green-800/50'
  },
  mp4: {
    label: 'Convertida',
    emoji: '\u{1F3AC}',
    badgeBg: 'bg-purple-700/40',
    badgeText: 'text-purple-300',
    selectBg: 'bg-purple-600',
    filterBg: 'bg-purple-900/50',
    filterRing: 'ring-purple-500',
    cardBg: 'bg-purple-900/20',
    cardBorder: 'border-purple-800/50'
  },
  server: {
    label: 'En servidor',
    emoji: '\u{1F4C1}',
    badgeBg: 'bg-emerald-700/40',
    badgeText: 'text-emerald-300',
    selectBg: 'bg-emerald-600',
    filterBg: 'bg-emerald-900/50',
    filterRing: 'ring-emerald-500',
    cardBg: 'bg-emerald-900/20',
    cardBorder: 'border-emerald-800/50'
  },
  rejected: {
    label: 'Rechazada',
    emoji: '\u{274C}',
    badgeBg: 'bg-red-700/40',
    badgeText: 'text-red-300',
    selectBg: 'bg-red-600',
    filterBg: 'bg-red-900/50',
    filterRing: 'ring-red-500',
    cardBg: 'bg-red-900/20',
    cardBorder: 'border-red-800/50'
  }
};
