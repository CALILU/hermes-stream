import { useMemo } from 'react';

/**
 * Motor de recomendaciones personalizado.
 * Analiza perfil de generos del usuario + recomendaciones TMDB cacheadas
 * + rating + estado de reproduccion para generar un ranking personalizado.
 */
export function useRecommendations(videos, favorites, allProgress, genres) {
  return useMemo(() => {
    if (!videos || videos.length < 5) return [];

    // 1. Identificar peliculas "consumidas" (vistas >30% o favoritas)
    const consumed = new Set();
    const consumedVideos = [];

    for (const v of videos) {
      const prog = allProgress[v.filename];
      const isFav = favorites.has(v.filename);
      const watched = prog && prog.progress > 30;
      if (watched || isFav) {
        consumed.add(v.filename);
        consumedVideos.push(v);
      }
    }

    // Si el usuario no ha visto nada ni tiene favoritos → top rated
    if (consumedVideos.length === 0) {
      return videos
        .filter(v => v.rating && v.rating >= 7)
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
        .slice(0, 15)
        .map(v => ({ ...v, _reason: 'Mejor valoradas' }));
    }

    // 2. Calcular perfil de afinidad por genero
    const genreCount = {};
    let totalGenres = 0;
    for (const v of consumedVideos) {
      if (!v.genreIds) continue;
      for (const gid of v.genreIds) {
        genreCount[gid] = (genreCount[gid] || 0) + 1;
        totalGenres++;
      }
    }
    const genreAffinity = {};
    for (const [gid, count] of Object.entries(genreCount)) {
      genreAffinity[gid] = count / totalGenres;
    }

    const genreMap = {};
    if (genres) {
      for (const g of genres) genreMap[g.id] = g.name;
    }

    // 3. Recopilar tmdbIds recomendados por TMDB desde pelis consumidas
    const tmdbRecommended = new Map(); // tmdbId → titulo de la peli que lo recomienda
    for (const v of consumedVideos) {
      if (!v.recommendations) continue;
      for (const rec of v.recommendations) {
        if (rec.tmdbId && !tmdbRecommended.has(rec.tmdbId)) {
          tmdbRecommended.set(rec.tmdbId, v.title);
        }
      }
    }

    // 4. Puntuar cada pelicula candidata
    const scored = [];
    const alreadyTopGenres = new Set();

    for (const v of videos) {
      // Excluir ya consumidas (vistas >80% o favoritas)
      const prog = allProgress[v.filename];
      if (prog && prog.progress > 80) continue;
      if (favorites.has(v.filename)) continue;

      let score = 0;
      let reason = '';

      // A. Afinidad por genero (0-3)
      if (v.genreIds && v.genreIds.length > 0) {
        let aff = 0;
        for (const gid of v.genreIds) {
          aff += genreAffinity[gid] || 0;
        }
        score += Math.min(aff * 3, 3);

        if (!reason && aff > 0.3) {
          const bestGenre = v.genreIds
            .sort((a, b) => (genreAffinity[b] || 0) - (genreAffinity[a] || 0))[0];
          reason = `Te gusta ${genreMap[bestGenre] || 'este genero'}`;
        }
      }

      // B. Recomendada por TMDB desde peli consumida (0-2)
      if (v.tmdbId && tmdbRecommended.has(v.tmdbId)) {
        score += 2;
        reason = `Similar a ${tmdbRecommended.get(v.tmdbId)}`;
      }

      // C. Rating TMDB (0-1)
      if (v.rating) {
        score += v.rating / 10;
        if (!reason && v.rating >= 7.5) {
          reason = `Valoracion ${v.rating.toFixed(1)}`;
        }
      }

      // D. No vista (0-1.5)
      if (!prog) {
        score += 1.5;
      } else if (prog.progress < 20) {
        score += 0.5;
      }

      // Fallback reason
      if (!reason) reason = 'Puede interesarte';

      if (score > 0.5) {
        scored.push({ ...v, _score: score, _reason: reason });
      }
    }

    // 5. Ordenar y aplicar penalizacion por diversidad
    scored.sort((a, b) => b._score - a._score);

    const result = [];
    for (const v of scored) {
      if (result.length >= 15) break;

      // Penalizar si el genero principal ya domina el resultado
      const mainGenre = v.genreIds?.[0];
      if (mainGenre && alreadyTopGenres.has(mainGenre) && result.length >= 5) {
        v._score -= 0.5;
        continue;
      }

      result.push(v);
      if (mainGenre) alreadyTopGenres.add(mainGenre);
    }

    // Re-sort tras penalizacion
    result.sort((a, b) => b._score - a._score);

    return result.slice(0, 15);
  }, [videos, favorites, allProgress, genres]);
}
