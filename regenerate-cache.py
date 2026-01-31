#!/usr/bin/env python3
"""
Regenerar cache de metadatos TMDB para IsiPrime
Ejecutar: python regenerate-cache.py
"""

import json
import os
import re
import time
from ftplib import FTP
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# Configuración
TMDB_API_KEY = os.getenv('TMDB_API_KEY')
FTP_HOST = os.getenv('FTP_HOST')
FTP_USER = os.getenv('FTP_USER')
FTP_PASSWORD = os.getenv('FTP_PASSWORD')
FTP_PORT = int(os.getenv('FTP_PORT', 21))

TMDB_BASE_URL = 'https://api.themoviedb.org/3'
TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342'

try:
    import requests
except ImportError:
    print("Instalando requests...")
    os.system('pip install requests')
    import requests


def clean_movie_name(filename):
    """Limpiar nombre de archivo para búsqueda"""
    name = re.sub(r'\.(mp4|mkv|avi|mov)$', '', filename, flags=re.IGNORECASE)
    name = re.sub(r'[._-]', ' ', name)
    name = re.sub(r'\s+', ' ', name).strip()

    year_match = re.search(r'\((\d{4})\)', filename)
    year = year_match.group(1) if year_match else None

    if year:
        name = re.sub(r'\(\d{4}\)', '', name).strip()

    return name, year


def search_tmdb(filename):
    """Buscar película en TMDB"""
    title, year = clean_movie_name(filename)

    try:
        # Buscar película
        params = {
            'api_key': TMDB_API_KEY,
            'query': title,
            'language': 'es-ES'
        }
        if year:
            params['year'] = year

        response = requests.get(f'{TMDB_BASE_URL}/search/movie', params=params, timeout=10)
        data = response.json()

        if not data.get('results'):
            return None

        movie = data['results'][0]

        # Obtener detalles con cast
        details_response = requests.get(
            f"{TMDB_BASE_URL}/movie/{movie['id']}",
            params={
                'api_key': TMDB_API_KEY,
                'language': 'es-ES',
                'append_to_response': 'credits,videos,recommendations'
            },
            timeout=10
        )
        details = details_response.json()

        # Procesar cast
        cast = []
        for actor in (details.get('credits', {}).get('cast', []))[:15]:
            cast.append({
                'id': actor['id'],
                'name': actor['name'],
                'character': actor.get('character', ''),
                'photo': f"https://image.tmdb.org/t/p/w185{actor['profile_path']}" if actor.get('profile_path') else None
            })

        # Procesar recomendaciones
        recommendations = []
        for r in (details.get('recommendations', {}).get('results', []))[:10]:
            recommendations.append({
                'tmdb_id': r['id'],
                'title': r['title'],
                'poster_path': f"{TMDB_IMAGE_BASE}{r['poster_path']}" if r.get('poster_path') else None,
                'release_date': r.get('release_date'),
                'vote_average': r.get('vote_average')
            })

        poster_url = f"{TMDB_IMAGE_BASE}{movie['poster_path']}" if movie.get('poster_path') else None
        backdrop_url = f"https://image.tmdb.org/t/p/w780{movie['backdrop_path']}" if movie.get('backdrop_path') else None

        return {
            'tmdb_id': movie['id'],
            'title': movie['title'],
            'overview': movie.get('overview', ''),
            'poster': poster_url,
            'poster_path': poster_url,
            'backdrop': backdrop_url,
            'backdrop_path': backdrop_url,
            'release_date': movie.get('release_date'),
            'vote_average': movie.get('vote_average'),
            'genre_ids': movie.get('genre_ids', []),
            'runtime': details.get('runtime'),
            'cast': cast,
            'recommendations': recommendations,
            'cached_at': int(time.time() * 1000)
        }
    except Exception as e:
        return None


def main():
    print('=' * 60)
    print('🔄 REGENERANDO CACHE DE METADATOS TMDB')
    print('=' * 60)

    # Cargar cache existente
    cache = {}
    try:
        with open('cache.json', 'r', encoding='utf-8') as f:
            cache = json.load(f)
    except:
        pass

    print(f'📦 Cache actual: {len(cache)} entradas\n')

    # Conectar a FTP y listar videos
    print('🔌 Conectando a FTP...')
    ftp = FTP()
    ftp.connect(FTP_HOST, FTP_PORT)
    ftp.login(FTP_USER, FTP_PASSWORD)
    ftp.set_pasv(True)

    files = ftp.nlst('/volume-1')
    videos = [os.path.basename(f) for f in files if re.search(r'\.(mp4|mkv|avi|mov)$', f, re.IGNORECASE)]
    ftp.quit()

    print(f'📂 Videos en FTP: {len(videos)}')

    # Filtrar los que no tienen metadatos
    missing = [v for v in videos if v not in cache or not cache[v].get('tmdb_id')]
    print(f'🔍 Sin metadatos: {len(missing)}')
    print('=' * 60 + '\n')

    if not missing:
        print('✅ Todos los videos tienen metadatos!')
        return

    found = 0
    not_found = 0
    start_time = time.time()

    for i, filename in enumerate(missing):
        short_name = filename[:45] + '...' if len(filename) > 48 else filename

        metadata = search_tmdb(filename)

        if metadata:
            cache[filename] = metadata
            found += 1
            print(f'✅ [{i+1}/{len(missing)}] {short_name}')
        else:
            not_found += 1
            print(f'❌ [{i+1}/{len(missing)}] {short_name}')

        # Guardar cada 25 películas
        if (i + 1) % 25 == 0:
            with open('cache.json', 'w', encoding='utf-8') as f:
                json.dump(cache, f, ensure_ascii=False, indent=2)

            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed if elapsed > 0 else 1
            remaining = (len(missing) - i - 1) / rate

            print(f'\n💾 Guardado parcial - {len(cache)} en cache')
            print(f'⏱️  Tiempo: {elapsed:.0f}s | Restante: ~{remaining:.0f}s')
            print(f'📊 Encontrados: {found} | No encontrados: {not_found}\n')

        # Pausa para no saturar TMDB API
        time.sleep(0.15)

    # Guardar final
    with open('cache.json', 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)

    total_time = time.time() - start_time

    print('\n' + '=' * 60)
    print(f'✅ COMPLETADO en {total_time:.1f} segundos')
    print(f'   Encontrados: {found}')
    print(f'   No encontrados: {not_found}')
    print(f'   Total en cache: {len(cache)}')
    print('=' * 60)


if __name__ == '__main__':
    main()
