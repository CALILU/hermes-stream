/**
 * lib/email-template.js - Generador de HTML para newsletter estilo Netflix
 * Layout: agrupado por generos, posters horizontales en fila adaptativa
 */

function generateNewsletterHTML(movies, options = {}) {
    const { subject = 'Nuevas peliculas en IsiPrime', appName = 'IsiPrime' } = options;

    // Frases rotativas para el subtitulo
    const phrases = [
        `${movies.length} ${movies.length === 1 ? 'pelicula' : 'peliculas'} que no te puedes perder`,
        `${movies.length} ${movies.length === 1 ? 'novedad' : 'novedades'} esperandote en IsiPrime`,
        `${movies.length} ${movies.length === 1 ? 'titulo nuevo' : 'titulos nuevos'} para tu proxima sesion`,
        `${movies.length} ${movies.length === 1 ? 'pelicula recien añadida' : 'peliculas recien añadidas'} para ti`,
        `Descubre ${movies.length} ${movies.length === 1 ? 'nueva pelicula' : 'nuevas peliculas'} en tu catalogo`,
        `${movies.length} ${movies.length === 1 ? 'razon' : 'razones'} para una noche de cine`,
        `Tu dosis semanal: ${movies.length} ${movies.length === 1 ? 'pelicula nueva' : 'peliculas nuevas'}`,
        `${movies.length} ${movies.length === 1 ? 'estreno' : 'estrenos'} que no puedes dejar escapar`,
    ];
    const subtitle = phrases[Math.floor(Math.random() * phrases.length)];

    // Agrupar peliculas por primer genero
    const genreGroups = {};
    movies.forEach(movie => {
        let genre = 'Otras';
        if (movie.genres) {
            if (Array.isArray(movie.genres) && movie.genres.length > 0) {
                genre = movie.genres[0];
            } else if (typeof movie.genres === 'string' && movie.genres.trim()) {
                genre = movie.genres.split(',')[0].trim();
            }
        }
        if (!genreGroups[genre]) genreGroups[genre] = [];
        genreGroups[genre].push(movie);
    });

    const CONTENT_WIDTH = 540; // 600 - 24px padding each side (approx)
    const GAP = 8;
    const MAX_POSTERS_PER_ROW = 4;
    const MAX_POSTER_WIDTH = 180;

    // Helper: genera una fila de posters
    function buildPosterRow(rowMovies, posterWidth) {
        return rowMovies.map((movie, i) => {
            const poster = movie.poster || '';
            const title = movie.title || movie.filename || 'Sin titulo';

            const imgCell = poster
                ? `<td align="center" style="padding-top:0;"><img src="${poster}" alt="${title}" width="${posterWidth}" style="display:block; width:${posterWidth}px; height:auto; border-radius:8px;" /></td>`
                : `<td align="center" style="padding-top:0;"><div style="width:${posterWidth}px; height:${Math.round(posterWidth * 1.5)}px; background-color:#2a2a3e; border-radius:8px;"></div></td>`;

            if (i === 0) return imgCell;
            return `<td style="width:${GAP}px; font-size:0; line-height:0;">&nbsp;</td>${imgCell}`;
        }).join('');
    }

    // Generar secciones por genero
    const genreSections = Object.entries(genreGroups).map(([genre, genreMovies], index) => {
        // Dividir en filas de MAX_POSTERS_PER_ROW
        const rows = [];
        for (let i = 0; i < genreMovies.length; i += MAX_POSTERS_PER_ROW) {
            rows.push(genreMovies.slice(i, i + MAX_POSTERS_PER_ROW));
        }

        const posterRows = rows.map((rowMovies, rowIndex) => {
            const n = rowMovies.length;
            let posterWidth = Math.floor((CONTENT_WIDTH - (n - 1) * GAP) / n);
            if (posterWidth > MAX_POSTER_WIDTH) posterWidth = MAX_POSTER_WIDTH;

            const topPadding = rowIndex > 0 ? 'padding-top:8px;' : '';

            // Pelicula sola: poster + sinopsis al lado
            if (n === 1 && genreMovies.length === 1) {
                const movie = rowMovies[0];
                const poster = movie.poster || '';
                const title = movie.title || movie.filename || 'Sin titulo';
                const overview = (movie.overview || '').substring(0, 150) + ((movie.overview || '').length > 150 ? '...' : '');
                const synopsisHTML = overview
                    ? `<td style="padding-left:12px; vertical-align:top;">
                        <p style="margin:0 0 6px 0; font-size:16px; font-weight:700; color:#ffffff; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${title}</p>
                        <p style="margin:0; font-size:14px; color:rgba(255,255,255,0.8); line-height:1.4; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">${overview}</p>
                      </td>`
                    : '';
                const imgHTML = poster
                    ? `<td style="width:${posterWidth}px; vertical-align:top;"><img src="${poster}" alt="${title}" width="${posterWidth}" style="display:block; width:${posterWidth}px; height:auto; border-radius:8px;" /></td>`
                    : `<td style="width:${posterWidth}px; vertical-align:top;"><div style="width:${posterWidth}px; height:${Math.round(posterWidth * 1.5)}px; background-color:#2a2a3e; border-radius:8px;"></div></td>`;

                return `<tr>
            <td${topPadding ? ` style="${topPadding}"` : ''}>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  ${imgHTML}${synopsisHTML}
                </tr>
              </table>
            </td>
          </tr>`;
            }

            return `<tr>
            <td${topPadding ? ` style="${topPadding}"` : ''}>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  ${buildPosterRow(rowMovies, posterWidth)}
                </tr>
              </table>
            </td>
          </tr>`;
        }).join('');

        // Spacer row before section (12px between genres)
        const spacerRow = index > 0
            ? `<tr><td style="height:12px; font-size:0; line-height:0;">&nbsp;</td></tr>`
            : '';

        return `${spacerRow}
          <!-- Genero: ${genre} -->
          <tr>
            <td style="padding: 12px 0 8px 0;">
              <h3 style="margin: 0; font-size: 24px; font-weight: 800; color: #ffffff; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">${genre}</h3>
            </td>
          </tr>
          ${posterRows}`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0f0f0f; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #0f0f0f;">
    <tr>
      <td align="center" style="padding: 20px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%; background-color: #0f0f0f;">

          <!-- Header -->
          <tr>
            <td style="padding: 32px 0; text-align: center; background-color: #0f0f0f;">
              <h1 style="margin: 0; font-size: 45px; font-weight: 900; letter-spacing: -1px; color: #c4b5fd; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">${appName}</h1>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="padding: 0 0 32px 0; text-align: center; background-color: #0f0f0f;">
              <h2 style="margin: 0 0 10px 0; font-size: 33px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">${subject}</h2>
              <p style="margin: 0; font-size: 20px; color: #ffffff; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">${subtitle}</p>
            </td>
          </tr>

          <!-- Movie Cards Container -->
          <tr>
            <td style="padding: 0 0 8px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #1a0a0a; background: linear-gradient(180deg, #2d0a0a 0%, #1a1025 50%, #0a1a0a 100%); border: 1px solid #3d1515; border-radius: 16px; overflow: hidden;">
                <tr>
                  <td style="padding: 8px 24px 28px 24px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      ${genreSections}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 0 32px 0; text-align: center; background-color: #0f0f0f;">
              <p style="margin: 0 0 8px 0; font-size: 18px; color: #ffffff; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                Enviado desde ${appName}
              </p>
              <p style="margin: 0; font-size: 17px; color: #ffffff; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
                Si no quieres recibir mas newsletters, contacta al administrador.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

module.exports = { generateNewsletterHTML };
