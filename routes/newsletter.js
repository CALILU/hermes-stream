/**
 * routes/newsletter.js - Newsletter API endpoints (admin only)
 *
 * POST /preview    - Generate HTML preview
 * POST /send       - Send newsletter to all users with email
 * GET  /history    - Newsletter send history
 * POST /test       - Send test email to admin
 *
 * Montado en: /api/newsletter
 */

const express = require('express');
const router = express.Router();
const posterCache = require('../lib/poster-cache');

module.exports = function createNewsletterRoutes(deps) {
    const { usersDB, emailService, emailTemplate, auth } = deps;

    /**
     * Convert proxy image URLs in movies to absolute TMDB URLs for email clients.
     * Email clients can't access LAN URLs like /api/img/...
     */
    function moviesForEmail(movies) {
        return movies.map(m => ({
            ...m,
            poster: posterCache.toTMDBURL(m.poster) || m.poster,
            backdrop: posterCache.toTMDBURL(m.backdrop) || m.backdrop
        }));
    }

    const authenticate = auth.authMiddleware(usersDB);
    const adminOnly = auth.requireRole('admin');

    /**
     * POST /preview
     * Generate newsletter HTML preview
     */
    router.post('/preview', authenticate, adminOnly, (req, res) => {
        try {
            const { movies, subject } = req.body;

            if (!movies || !Array.isArray(movies) || movies.length === 0) {
                return res.status(400).json({ error: 'Se requiere al menos una pelicula', code: 'NO_MOVIES' });
            }

            const html = emailTemplate.generateNewsletterHTML(moviesForEmail(movies), { subject: subject || 'Nuevas peliculas en IsiPrime' });

            res.json({ success: true, html });
        } catch (err) {
            console.error('[Newsletter] Error generando preview:', err);
            res.status(500).json({ error: 'Error generando preview', code: 'SERVER_ERROR' });
        }
    });

    /**
     * POST /send
     * Send newsletter to all users with email
     */
    router.post('/send', authenticate, adminOnly, async (req, res) => {
        try {
            const { movies, subject, recipientIds } = req.body;

            if (!movies || !Array.isArray(movies) || movies.length === 0) {
                return res.status(400).json({ error: 'Se requiere al menos una pelicula', code: 'NO_MOVIES' });
            }

            let recipients = usersDB.getUsersWithEmail();

            // Filter by selected recipient IDs if provided
            if (Array.isArray(recipientIds) && recipientIds.length > 0) {
                const idSet = new Set(recipientIds);
                recipients = recipients.filter(r => idSet.has(r.id));
            }

            if (recipients.length === 0) {
                return res.status(400).json({ error: 'No hay usuarios con email configurado', code: 'NO_RECIPIENTS' });
            }

            const emailSubject = subject || 'Nuevas peliculas en IsiPrime';
            const html = emailTemplate.generateNewsletterHTML(moviesForEmail(movies), { subject: emailSubject });

            const results = await emailService.sendBulkEmails(recipients, emailSubject, html);

            // Log newsletter + movies + HTML
            const logEntry = usersDB.logNewsletter({
                subject: emailSubject,
                movieCount: movies.length,
                recipientsCount: results.sent,
                sentBy: req.user.id,
                status: results.failed > 0 ? 'partial' : 'sent',
                htmlContent: html
            });
            if (logEntry) usersDB.logNewsletterMovies(logEntry.id, movies);

            res.json({
                success: true,
                data: {
                    sent: results.sent,
                    failed: results.failed,
                    total: recipients.length,
                    errors: results.errors
                }
            });
        } catch (err) {
            console.error('[Newsletter] Error enviando newsletter:', err);
            res.status(500).json({ error: 'Error enviando newsletter', code: 'SERVER_ERROR' });
        }
    });

    /**
     * GET /history
     * Get newsletter send history
     */
    router.get('/history', authenticate, adminOnly, (req, res) => {
        try {
            const history = usersDB.getNewsletterHistory();
            res.json({ success: true, data: history });
        } catch (err) {
            console.error('[Newsletter] Error obteniendo historial:', err);
            res.status(500).json({ error: 'Error obteniendo historial', code: 'SERVER_ERROR' });
        }
    });

    /**
     * GET /sent-movies
     * Get list of filenames that have been sent in any newsletter
     */
    router.get('/sent-movies', authenticate, adminOnly, (req, res) => {
        try {
            const filenames = usersDB.getSentMovieFilenames();
            res.json({ success: true, data: filenames });
        } catch (err) {
            console.error('[Newsletter] Error obteniendo peliculas enviadas:', err);
            res.status(500).json({ error: 'Error obteniendo peliculas enviadas', code: 'SERVER_ERROR' });
        }
    });

    /**
     * DELETE /history/:id
     * Delete a newsletter log entry
     */
    router.delete('/history/:id', authenticate, adminOnly, (req, res) => {
        try {
            usersDB.deleteNewsletterLog(parseInt(req.params.id));
            res.json({ success: true });
        } catch (err) {
            console.error('[Newsletter] Error eliminando registro:', err);
            res.status(500).json({ error: 'Error eliminando registro', code: 'SERVER_ERROR' });
        }
    });

    /**
     * POST /test
     * Send test email to the admin's own email
     */
    router.post('/test', authenticate, adminOnly, async (req, res) => {
        try {
            const { movies, subject, testEmail } = req.body;

            // Get admin's email or use provided testEmail
            const adminUser = usersDB.getUserById(req.user.id);
            const email = testEmail || (adminUser && adminUser.email);

            if (!email) {
                return res.status(400).json({ error: 'No hay email de destino. Configura tu email o proporciona testEmail.', code: 'NO_EMAIL' });
            }

            if (!movies || !Array.isArray(movies) || movies.length === 0) {
                return res.status(400).json({ error: 'Se requiere al menos una pelicula', code: 'NO_MOVIES' });
            }

            const emailSubject = `[TEST] ${subject || 'Nuevas peliculas en IsiPrime'}`;
            const html = emailTemplate.generateNewsletterHTML(moviesForEmail(movies), { subject: subject || 'Nuevas peliculas en IsiPrime' });

            await emailService.sendEmail(email, emailSubject, html);

            // Log test send in history + movies + HTML
            const logEntry = usersDB.logNewsletter({
                subject: emailSubject,
                movieCount: movies.length,
                recipientsCount: 1,
                sentBy: req.user.id,
                status: 'test',
                htmlContent: html
            });
            if (logEntry) usersDB.logNewsletterMovies(logEntry.id, movies);

            res.json({ success: true, message: `Email de prueba enviado a ${email}` });
        } catch (err) {
            console.error('[Newsletter] Error enviando test:', err);
            res.status(500).json({ error: `Error enviando test: ${err.message}`, code: 'SEND_ERROR' });
        }
    });

    /**
     * GET /:id
     * Get a specific newsletter with HTML content
     */
    router.get('/:id', authenticate, adminOnly, (req, res) => {
        try {
            const entry = usersDB.getNewsletterById(parseInt(req.params.id));
            if (!entry) {
                return res.status(404).json({ error: 'Newsletter no encontrado', code: 'NOT_FOUND' });
            }
            res.json({ success: true, data: entry });
        } catch (err) {
            console.error('[Newsletter] Error obteniendo newsletter:', err);
            res.status(500).json({ error: 'Error obteniendo newsletter', code: 'SERVER_ERROR' });
        }
    });

    /**
     * POST /:id/resend
     * Resend a saved newsletter to selected recipients
     */
    router.post('/:id/resend', authenticate, adminOnly, async (req, res) => {
        try {
            const entry = usersDB.getNewsletterById(parseInt(req.params.id));
            if (!entry || !entry.html_content) {
                return res.status(400).json({ error: 'Newsletter sin contenido HTML guardado', code: 'NO_HTML' });
            }

            const { recipientIds } = req.body;
            let recipients = usersDB.getUsersWithEmail();

            if (Array.isArray(recipientIds) && recipientIds.length > 0) {
                const idSet = new Set(recipientIds);
                recipients = recipients.filter(r => idSet.has(r.id));
            }

            if (recipients.length === 0) {
                return res.status(400).json({ error: 'No hay destinatarios seleccionados', code: 'NO_RECIPIENTS' });
            }

            const results = await emailService.sendBulkEmails(recipients, entry.subject, entry.html_content);

            // Log resend as new entry
            usersDB.logNewsletter({
                subject: `[Reenvio] ${entry.subject}`,
                movieCount: entry.movie_count,
                recipientsCount: results.sent,
                sentBy: req.user.id,
                status: 'resent',
                htmlContent: entry.html_content
            });

            res.json({
                success: true,
                data: {
                    sent: results.sent,
                    failed: results.failed,
                    total: recipients.length,
                    errors: results.errors
                }
            });
        } catch (err) {
            console.error('[Newsletter] Error reenviando newsletter:', err);
            res.status(500).json({ error: 'Error reenviando newsletter', code: 'SERVER_ERROR' });
        }
    });

    return router;
};
