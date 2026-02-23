/**
 * routes/auth.js - Authentication routes
 *
 * POST /login          - Authenticate user, return JWT tokens
 * POST /refresh        - Refresh access token using refresh token
 * POST /logout         - Revoke refresh token / session
 * GET  /status         - Check auth status (requires auth)
 * GET  /users          - List all users (admin only)
 * POST /users          - Create user (admin only)
 * DELETE /users/:id    - Soft-delete user (admin only)
 * POST /invitations    - Create invitation code (admin only)
 * GET  /invitations    - List invitations (admin only)
 * DELETE /invitations/:id - Delete unused invitation (admin only)
 * POST /register       - Register via invitation code (public)
 * GET  /sessions       - List user's active sessions (requires auth)
 * DELETE /sessions/:id - Revoke a session (requires auth)
 *
 * Montado en: /api/auth
 *
 * @author IsiPrime
 */

const express = require('express');
const router = express.Router();

module.exports = function createAuthRoutes(deps) {
    const { usersDB, auth } = deps;

    // Destructure what we need from auth
    const {
        generateAccessToken,
        generateRefreshToken,
        hashPassword,
        comparePassword,
        isLegacySHA256,
        verifySHA256,
        getClientIP,
        getRefreshTokenExpiryDate,
        authMiddleware,
        requireRole,
        loginRateLimit
    } = auth;

    // Create middleware instances
    const authenticate = authMiddleware(usersDB);
    const adminOnly = requireRole('admin');
    const rateLimitLogin = loginRateLimit();

    // ============================================
    // PUBLIC ENDPOINTS
    // ============================================

    /**
     * POST /login
     * Authenticate with username/password, receive JWT tokens
     */
    router.post('/login', rateLimitLogin, async (req, res) => {
        try {
            const { username, password } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    error: 'Usuario y contrasena requeridos',
                    code: 'MISSING_CREDENTIALS'
                });
            }

            // Look up user
            const user = usersDB.getUserByUsername(username);

            if (!user || !user.active) {
                if (req.recordLoginAttempt) req.recordLoginAttempt();
                return res.status(401).json({
                    error: 'Credenciales invalidas',
                    code: 'INVALID_CREDENTIALS'
                });
            }

            // Verify password (with legacy SHA256 auto-migration)
            let passwordValid = false;

            if (isLegacySHA256(user.password_hash)) {
                // Legacy SHA256 hash - verify then auto-migrate to bcrypt
                passwordValid = verifySHA256(password, user.password_hash);

                if (passwordValid) {
                    // Auto-migrate to bcrypt
                    const bcryptHash = await hashPassword(password);
                    try {
                        usersDB.updateUser(user.id, { password_hash: bcryptHash });
                        console.log(`[Auth] Password migrada a bcrypt para usuario: ${username}`);
                    } catch (migrationErr) {
                        console.error(`[Auth] Error migrando password para ${username}:`, migrationErr.message);
                        // Continue anyway - login is still valid
                    }
                }
            } else {
                // Bcrypt hash
                passwordValid = await comparePassword(password, user.password_hash);
            }

            if (!passwordValid) {
                if (req.recordLoginAttempt) req.recordLoginAttempt();
                return res.status(401).json({
                    error: 'Credenciales invalidas',
                    code: 'INVALID_CREDENTIALS'
                });
            }

            // Generate tokens
            const accessToken = generateAccessToken(user);
            const refreshToken = generateRefreshToken();
            const expiresAt = getRefreshTokenExpiryDate();

            // Create session in DB
            usersDB.createSession({
                userId: user.id,
                refreshToken,
                deviceInfo: req.headers['user-agent'] || 'unknown',
                ipAddress: getClientIP(req),
                expiresAt
            });

            // Update last login
            usersDB.updateUser(user.id, { last_login: new Date().toISOString() });

            res.json({
                success: true,
                accessToken,
                refreshToken,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    displayName: user.display_name || user.username
                }
            });
        } catch (err) {
            console.error('[Auth] Error en login:', err);
            res.status(500).json({ error: 'Error interno del servidor', code: 'SERVER_ERROR' });
        }
    });

    /**
     * POST /refresh
     * Exchange a valid refresh token for new access + refresh tokens
     */
    router.post('/refresh', (req, res) => {
        try {
            const { refreshToken } = req.body;

            if (!refreshToken) {
                return res.status(400).json({
                    error: 'Refresh token requerido',
                    code: 'MISSING_TOKEN'
                });
            }

            // Look up session by refresh token
            const session = usersDB.getSessionByToken(refreshToken);

            if (!session) {
                return res.status(401).json({
                    error: 'Sesion no encontrada o revocada',
                    code: 'SESSION_NOT_FOUND'
                });
            }

            // Check expiry
            if (new Date(session.expires_at) < new Date()) {
                usersDB.revokeSession(session.id);
                return res.status(401).json({
                    error: 'Sesion expirada',
                    code: 'SESSION_EXPIRED'
                });
            }

            // Get user info for token generation
            const user = usersDB.getUserById(session.user_id);
            if (!user || !user.active) {
                usersDB.revokeSession(session.id);
                return res.status(401).json({
                    error: 'Usuario no encontrado o desactivado',
                    code: 'USER_INACTIVE'
                });
            }

            // Revoke old session
            usersDB.revokeSession(session.id);

            // Generate new tokens
            const newAccessToken = generateAccessToken(user);
            const newRefreshToken = generateRefreshToken();
            const expiresAt = getRefreshTokenExpiryDate();

            // Create new session
            usersDB.createSession({
                userId: user.id,
                refreshToken: newRefreshToken,
                deviceInfo: session.device_info || req.headers['user-agent'] || 'unknown',
                ipAddress: getClientIP(req),
                expiresAt
            });

            res.json({
                success: true,
                accessToken: newAccessToken,
                refreshToken: newRefreshToken
            });
        } catch (err) {
            console.error('[Auth] Error en refresh:', err);
            res.status(500).json({ error: 'Error interno del servidor', code: 'SERVER_ERROR' });
        }
    });

    /**
     * POST /logout
     * Revoke the refresh token / session
     */
    router.post('/logout', (req, res) => {
        try {
            const { refreshToken } = req.body;

            if (refreshToken) {
                const session = usersDB.getSessionByToken(refreshToken);
                if (session) {
                    usersDB.revokeSession(session.id);
                }
            }

            res.json({ success: true });
        } catch (err) {
            console.error('[Auth] Error en logout:', err);
            res.status(500).json({ error: 'Error interno del servidor', code: 'SERVER_ERROR' });
        }
    });

    /**
     * POST /register
     * Register a new user using an invitation code
     */
    router.post('/register', async (req, res) => {
        try {
            const { code, username, password } = req.body;

            if (!code || !username || !password) {
                return res.status(400).json({
                    error: 'Codigo de invitacion, usuario y contrasena requeridos',
                    code: 'MISSING_FIELDS'
                });
            }

            // Validate invitation code
            const invitation = usersDB.getInvitationByCode(code);

            if (!invitation) {
                return res.status(400).json({
                    error: 'Codigo de invitacion invalido o ya usado',
                    code: 'INVALID_INVITATION'
                });
            }

            if (new Date(invitation.expires_at) < new Date()) {
                return res.status(400).json({
                    error: 'Codigo de invitacion expirado',
                    code: 'INVITATION_EXPIRED'
                });
            }

            // Validate password length
            if (password.length < 8) {
                return res.status(400).json({
                    error: 'La contrasena debe tener al menos 8 caracteres',
                    code: 'PASSWORD_TOO_SHORT'
                });
            }

            // Validate username format
            if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
                return res.status(400).json({
                    error: 'El nombre de usuario debe tener entre 3-30 caracteres (letras, numeros, _ o -)',
                    code: 'INVALID_USERNAME'
                });
            }

            // Check username not taken
            const existingUser = usersDB.getUserByUsername(username);
            if (existingUser) {
                return res.status(409).json({
                    error: 'El nombre de usuario ya esta en uso',
                    code: 'USERNAME_TAKEN'
                });
            }

            // Hash password and create user
            const passwordHash = await hashPassword(password);
            const newUser = usersDB.createUser({
                username,
                passwordHash,
                role: invitation.role || 'viewer',
                displayName: username
            });

            // Mark invitation as used
            usersDB.useInvitation(invitation.code, newUser.id);

            res.status(201).json({
                success: true,
                message: 'Cuenta creada'
            });
        } catch (err) {
            console.error('[Auth] Error en registro:', err);
            res.status(500).json({ error: 'Error interno del servidor', code: 'SERVER_ERROR' });
        }
    });

    // ============================================
    // AUTHENTICATED ENDPOINTS
    // ============================================

    /**
     * GET /status
     * Check current authentication status
     */
    router.get('/status', authenticate, (req, res) => {
        res.json({
            authenticated: true,
            user: req.user,
            isLocal: req.user.isLocal || false
        });
    });

    /**
     * GET /sessions
     * List the current user's active sessions
     */
    router.get('/sessions', authenticate, (req, res) => {
        try {
            const sessions = usersDB.getUserSessions(req.user.id);
            res.json({ success: true, data: sessions });
        } catch (err) {
            console.error('[Auth] Error listando sesiones:', err);
            res.status(500).json({ error: 'Error interno del servidor', code: 'SERVER_ERROR' });
        }
    });

    /**
     * DELETE /sessions/:id
     * Revoke a specific session (must belong to the user, or user is admin)
     */
    router.delete('/sessions/:id', authenticate, (req, res) => {
        try {
            const sessionId = parseInt(req.params.id);
            if (isNaN(sessionId)) {
                return res.status(400).json({ error: 'ID de sesion invalido', code: 'INVALID_ID' });
            }

            const session = usersDB.getSessionById(sessionId);
            if (!session) {
                return res.status(404).json({ error: 'Sesion no encontrada', code: 'NOT_FOUND' });
            }

            // Verify ownership or admin
            if (session.user_id !== req.user.id && req.user.role !== 'admin') {
                return res.status(403).json({
                    error: 'No tienes permisos para revocar esta sesion',
                    code: 'FORBIDDEN'
                });
            }

            usersDB.revokeSession(sessionId);
            res.json({ success: true });
        } catch (err) {
            console.error('[Auth] Error revocando sesion:', err);
            res.status(500).json({ error: 'Error interno del servidor', code: 'SERVER_ERROR' });
        }
    });

    // ============================================
    // ADMIN ENDPOINTS
    // ============================================

    /**
     * GET /users
     * List all users (admin only)
     */
    router.get('/users', authenticate, adminOnly, (req, res) => {
        try {
            const users = usersDB.getAllUsers();
            res.json({ success: true, data: users });
        } catch (err) {
            console.error('[Auth] Error listando usuarios:', err);
            res.status(500).json({ error: 'Error interno del servidor', code: 'SERVER_ERROR' });
        }
    });

    /**
     * POST /users
     * Create a new user (admin only)
     */
    router.post('/users', authenticate, adminOnly, async (req, res) => {
        try {
            const { username, password, role, displayName } = req.body;

            if (!username || !password) {
                return res.status(400).json({
                    error: 'Usuario y contrasena requeridos',
                    code: 'MISSING_FIELDS'
                });
            }

            if (password.length < 8) {
                return res.status(400).json({
                    error: 'La contrasena debe tener al menos 8 caracteres',
                    code: 'PASSWORD_TOO_SHORT'
                });
            }

            // Check username not taken
            const existingUser = usersDB.getUserByUsername(username);
            if (existingUser) {
                return res.status(409).json({
                    error: 'El nombre de usuario ya esta en uso',
                    code: 'USERNAME_TAKEN'
                });
            }

            const passwordHash = await hashPassword(password);
            const newUser = usersDB.createUser({
                username,
                passwordHash,
                role: role || 'user',
                displayName: displayName || username
            });

            res.status(201).json({
                success: true,
                data: {
                    id: newUser.id,
                    username: newUser.username,
                    role: newUser.role,
                    displayName: newUser.display_name || newUser.username
                }
            });
        } catch (err) {
            console.error('[Auth] Error creando usuario:', err);
            res.status(500).json({ error: 'Error interno del servidor', code: 'SERVER_ERROR' });
        }
    });

    /**
     * DELETE /users/:id
     * Soft-delete a user and revoke all their sessions (admin only)
     */
    router.delete('/users/:id', authenticate, adminOnly, (req, res) => {
        try {
            const userId = parseInt(req.params.id);
            if (isNaN(userId)) {
                return res.status(400).json({ error: 'ID de usuario invalido', code: 'INVALID_ID' });
            }

            // Prevent self-deletion
            if (userId === req.user.id) {
                return res.status(400).json({
                    error: 'No puedes eliminar tu propia cuenta',
                    code: 'SELF_DELETE'
                });
            }

            const user = usersDB.getUserById(userId);
            if (!user) {
                return res.status(404).json({ error: 'Usuario no encontrado', code: 'NOT_FOUND' });
            }

            // Soft delete user
            usersDB.deleteUser(userId);

            // Revoke all their sessions
            usersDB.revokeAllUserSessions(userId);

            res.json({ success: true });
        } catch (err) {
            console.error('[Auth] Error eliminando usuario:', err);
            res.status(500).json({ error: 'Error interno del servidor', code: 'SERVER_ERROR' });
        }
    });

    /**
     * POST /invitations
     * Create an invitation code (admin only)
     */
    router.post('/invitations', authenticate, adminOnly, (req, res) => {
        try {
            const { expiresInDays, role } = req.body;
            const days = parseInt(expiresInDays) || 7;
            const expiresDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

            const invitation = usersDB.createInvitation(req.user.id, expiresDate.toISOString(), role || 'viewer');

            // Build invitation link
            const protocol = req.protocol;
            const host = req.get('host');
            const link = `${protocol}://${host}/register?code=${invitation.code}`;

            res.status(201).json({
                success: true,
                data: {
                    code: invitation.code,
                    link,
                    expiresAt: invitation.expiresAt
                }
            });
        } catch (err) {
            console.error('[Auth] Error creando invitacion:', err);
            res.status(500).json({ error: 'Error interno del servidor', code: 'SERVER_ERROR' });
        }
    });

    /**
     * GET /invitations
     * List invitations (admin sees all, or filtered by creator)
     */
    router.get('/invitations', authenticate, adminOnly, (req, res) => {
        try {
            const invitations = usersDB.getInvitations(req.user.id);
            res.json({ success: true, data: invitations });
        } catch (err) {
            console.error('[Auth] Error listando invitaciones:', err);
            res.status(500).json({ error: 'Error interno del servidor', code: 'SERVER_ERROR' });
        }
    });

    /**
     * DELETE /invitations/:id
     * Delete an unused invitation (admin only)
     */
    router.delete('/invitations/:id', authenticate, adminOnly, (req, res) => {
        try {
            const invitationId = parseInt(req.params.id);
            if (isNaN(invitationId)) {
                return res.status(400).json({ error: 'ID de invitacion invalido', code: 'INVALID_ID' });
            }

            const deleted = usersDB.deleteInvitation(invitationId);
            if (!deleted) {
                return res.status(404).json({
                    error: 'Invitacion no encontrada o ya utilizada',
                    code: 'NOT_FOUND'
                });
            }

            res.json({ success: true });
        } catch (err) {
            console.error('[Auth] Error eliminando invitacion:', err);
            res.status(500).json({ error: 'Error interno del servidor', code: 'SERVER_ERROR' });
        }
    });

    return router;
};
