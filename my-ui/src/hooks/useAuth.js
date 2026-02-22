import { useState, useEffect } from 'react';
import { API_BASE } from '../constants';
import { authFetch, setAccessToken, getAccessToken, setRefreshToken, getRefreshToken } from '../utils/api';

export function useAuth() {
  const [authState, setAuthState] = useState({
    checking: true,
    isLocal: true,
    authenticated: false,
    user: null,
    requiresLogin: false
  });
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Check auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      // If we have a refresh token, try to get a new access token
      const refreshToken = getRefreshToken();
      if (refreshToken) {
        try {
          const response = await fetch(`${API_BASE}/api/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
          });

          if (response.ok) {
            const data = await response.json();
            setAccessToken(data.accessToken);
            setRefreshToken(data.refreshToken);
            setAuthState({
              checking: false,
              isLocal: false,
              authenticated: true,
              user: data.user || { username: 'user', role: 'viewer' },
              requiresLogin: false
            });
            return;
          } else {
            // Refresh token expired
            setRefreshToken(null);
            setAccessToken(null);
          }
        } catch (error) {
          console.error('Error refreshing token:', error);
        }
      }

      // No refresh token or refresh failed — check auth status
      // (handles LAN auto-auth)
      try {
        const response = await authFetch(`${API_BASE}/api/auth/status`);
        const data = await response.json();

        setAuthState({
          checking: false,
          isLocal: data.isLocal,
          authenticated: data.authenticated,
          user: data.user,
          requiresLogin: !data.authenticated
        });
      } catch (error) {
        console.error('Error checking auth:', error);
        setAuthState({
          checking: false,
          isLocal: true,
          authenticated: true,
          user: null,
          requiresLogin: false
        });
      }
    };

    checkAuth();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });

      const data = await response.json();

      if (data.success) {
        setAccessToken(data.accessToken);
        setRefreshToken(data.refreshToken);
        setAuthState({
          checking: false,
          isLocal: false,
          authenticated: true,
          user: data.user,
          requiresLogin: false
        });
        setLoginForm({ username: '', password: '' });
      } else {
        setLoginError(data.error || 'Error al iniciar sesion');
      }
    } catch (error) {
      console.error('Error en login:', error);
      setLoginError('Error de conexion');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    const refreshToken = getRefreshToken();
    try {
      await authFetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });
    } catch (error) {
      console.error('Error en logout:', error);
    }
    setAccessToken(null);
    setRefreshToken(null);
    setAuthState(prev => ({
      ...prev,
      authenticated: false,
      user: null,
      requiresLogin: true
    }));
  };

  return {
    authState, setAuthState,
    loginForm, setLoginForm,
    loginError, loginLoading,
    handleLogin, handleLogout
  };
}
