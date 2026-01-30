#!/usr/bin/env python3
"""
Script para reconstruir completamente el cache de películas de IsiPrime.
Busca todos los metadatos de TMDB: poster, backdrop, cast, recomendaciones, etc.
"""

import os
import re
import json
import time
import requests
from pathlib import Path
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

TMDB_API_KEY = os.getenv('TMDB_API_KEY')
TMDB_BASE_URL = 'https://api.themoviedb.org/3'
TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342'
TMDB_IMAGE_ORIGINAL = 'https://image.tmdb.org/t/p/original'

SCRIPT_DIR = Path(__file__).parent
CACHE_FILE = SCRIPT_DIR / 'cache.json'
STORAGE_FILE = SCRIPT_DIR / 'storage-settings.json'

def get_local_path():
    """Obtener ruta local desde configuración"""
    try:
        with open(STORAGE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data.get('localPath', 'E:\\')
    except:
        return 'E:\\'

def clean_filename(filename):
    """Limpiar nombre de archivo para búsqueda en TMDB"""
    name = re.sub(r'\.(mp4|mkv|avi|mov)$', '', filename, flags=re.IGNORECASE)

    # Extraer año si existe
    year_match = re.search(r'\((\d{4})\)', name)
    year = year_match.group(1) if year_match else None

    # Limpiar nombre
    name = re.sub(r'\(\d{4}\)', '', name)
    name = re.sub(r'[\._-]', ' ', name)
    name = re.sub(r'\s+', ' ', name).strip()

    return name, year

def search_tmdb(query, year=None):
    """Buscar película en TMDB"""
    try:
        params = {
            'api_key': TMDB_API_KEY,
            'language': 'es-ES',
            'query': query
        }
        if year:
            params['year'] = year

        response = requests.get(f'{TMDB_BASE_URL}/search/movie', params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        if data.get('results'):
            return data['results'][0]
        return None
    except Exception as e:
        print(f"  ⚠️ Error buscando: {e}")
        return None

def get_movie_details(tmdb_id):
    """Obtener detalles completos de película incluyendo cast y videos"""
    try:
        params = {
            'api_key': TMDB_API_KEY,
            'language': 'es-ES',
            'append_to_response': 'credits,videos,recommendations'
        }

        response = requests.get(f'{TMDB_BASE_URL}/movie/{tmdb_id}', params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"  ⚠️ Error obteniendo detalles: {e}")
        return None

def build_movie_metadata(movie, details=None):
    """Construir objeto de metadatos completo"""
    metadata = {
        'tmdb_id': movie['id'],
        'title': movie.get('title', ''),
        'overview': movie.get('overview', ''),
        'poster': f"{TMDB_IMAGE_BASE}{movie['poster_path']}" if movie.get('poster_path') else None,
        'poster_path': f"{TMDB_IMAGE_BASE}{movie['poster_path']}" if movie.get('poster_path') else None,
        'backdrop': f"{TMDB_IMAGE_BASE}{movie['backdrop_path']}" if movie.get('backdrop_path') else None,
        'backdrop_path': f"{TMDB_IMAGE_BASE}{movie['backdrop_path']}" if movie.get('backdrop_path') else None,
        'release_date': movie.get('release_date', ''),
        'vote_average': movie.get('vote_average', 0),
        'genre_ids': movie.get('genre_ids', []),
        'cached_at': int(time.time() * 1000)
    }

    if details:
        # Runtime
        metadata['runtime'] = details.get('runtime')

        # Géneros completos
        if details.get('genres'):
            metadata['genre_ids'] = [g['id'] for g in details['genres']]

        # Collection/Saga
        if details.get('belongs_to_collection'):
            coll = details['belongs_to_collection']
            metadata['collection'] = {
                'id': coll['id'],
                'name': coll['name'],
                'poster_path': f"{TMDB_IMAGE_BASE}{coll['poster_path']}" if coll.get('poster_path') else None,
                'backdrop_path': f"{TMDB_IMAGE_BASE}{coll['backdrop_path']}" if coll.get('backdrop_path') else None
            }

        # Cast (primeros 15 actores)
        if details.get('credits', {}).get('cast'):
            metadata['cast'] = []
            for actor in details['credits']['cast'][:15]:
                metadata['cast'].append({
                    'id': actor['id'],
                    'name': actor['name'],
                    'character': actor.get('character', ''),
                    'photo': f"{TMDB_IMAGE_BASE}{actor['profile_path']}" if actor.get('profile_path') else None
                })

        # Videos/Trailers
        if details.get('videos', {}).get('results'):
            metadata['videos'] = []
            for video in details['videos']['results']:
                if video.get('site') == 'YouTube':
                    metadata['videos'].append({
                        'key': video['key'],
                        'name': video['name'],
                        'type': video['type']
                    })

        # Recomendaciones (primeras 10)
        if details.get('recommendations', {}).get('results'):
            metadata['recommendations'] = []
            for rec in details['recommendations']['results'][:10]:
                metadata['recommendations'].append({
                    'tmdb_id': rec['id'],
                    'title': rec['title'],
                    'overview': rec.get('overview', '')[:200],
                    'poster_path': f"{TMDB_IMAGE_BASE}{rec['poster_path']}" if rec.get('poster_path') else None,
                    'release_date': rec.get('release_date', ''),
                    'vote_average': rec.get('vote_average', 0)
                })

    return metadata

def rebuild_cache():
    """Reconstruir cache completo"""
    local_path = get_local_path()

    print(f"\n{'='*60}")
    print(f"🎬 RECONSTRUCCIÓN DE CACHE DE ISIPRIME")
    print(f"{'='*60}")
    print(f"📂 Directorio: {local_path}")
    print(f"💾 Cache: {CACHE_FILE}")
    print(f"{'='*60}\n")

    if not TMDB_API_KEY:
        print("❌ Error: TMDB_API_KEY no configurada en .env")
        return

    # Verificar directorio
    if not os.path.exists(local_path):
        print(f"❌ El directorio no existe: {local_path}")
        return

    # Listar películas
    video_extensions = ('.mp4', '.mkv', '.avi', '.mov')
    files = [f for f in os.listdir(local_path) if f.lower().endswith(video_extensions)]
    files.sort()

    print(f"📦 Encontradas {len(files)} películas\n")

    # Cargar cache existente para no perder datos
    cache = {}
    try:
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            cache = json.load(f)
        print(f"📋 Cache existente: {len(cache)} entradas")
    except:
        print("📋 Creando nuevo cache")

    # Estadísticas
    stats = {
        'total': len(files),
        'found': 0,
        'not_found': 0,
        'skipped': 0,
        'errors': 0
    }

    print(f"\n{'─'*60}")
    print("Procesando películas...\n")

    for i, filename in enumerate(files, 1):
        # Verificar si ya tiene cache completo con poster
        if filename in cache and cache[filename].get('poster') and cache[filename].get('cast'):
            stats['skipped'] += 1
            print(f"[{i}/{len(files)}] ⏭️  Ya en cache: {filename[:50]}")
            continue

        name, year = clean_filename(filename)
        print(f"[{i}/{len(files)}] 🔍 Buscando: {name} ({year or 'sin año'})...")

        # Buscar en TMDB
        movie = search_tmdb(name, year)

        if not movie:
            # Intentar sin año
            movie = search_tmdb(name)

        if movie:
            # Obtener detalles completos
            details = get_movie_details(movie['id'])
            time.sleep(0.1)  # Pequeña pausa entre llamadas

            # Construir metadatos
            metadata = build_movie_metadata(movie, details)
            cache[filename] = metadata
            stats['found'] += 1
            print(f"         ✅ Encontrada: {metadata['title']} ({metadata.get('release_date', '')[:4]})")
        else:
            stats['not_found'] += 1
            # Guardar entrada básica
            cache[filename] = {
                'title': name,
                'poster': None,
                'not_found': True,
                'cached_at': int(time.time() * 1000)
            }
            print(f"         ❌ No encontrada")

        # Guardar cache cada 25 películas
        if i % 25 == 0:
            with open(CACHE_FILE, 'w', encoding='utf-8') as f:
                json.dump(cache, f, indent=2, ensure_ascii=False)
            print(f"\n💾 Cache guardado ({len(cache)} entradas)\n")

        # Pausa para respetar rate limit de TMDB (40 req/10s)
        time.sleep(0.25)

    # Guardar cache final
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)

    # Contar películas con poster
    with_poster = sum(1 for v in cache.values() if v.get('poster'))

    print(f"\n{'='*60}")
    print("✅ PROCESO COMPLETADO")
    print(f"{'='*60}")
    print(f"📊 Total películas escaneadas: {stats['total']}")
    print(f"✅ Encontradas en TMDB: {stats['found']}")
    print(f"⏭️  Ya estaban en cache: {stats['skipped']}")
    print(f"❌ No encontradas: {stats['not_found']}")
    print(f"💾 Total en cache: {len(cache)}")
    print(f"🖼️  Con carátula: {with_poster}")
    print(f"{'='*60}\n")

if __name__ == '__main__':
    rebuild_cache()
