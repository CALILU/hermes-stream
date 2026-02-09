import { useState, useEffect } from 'react';
import { API_BASE } from '../constants';
import { authFetch, setSessionToken } from '../utils/api';

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

  // Verificar estado de autenticacion al cargar
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await authFetch(`${API_BASE}/api/auth/status`);
        const data = await response.json();

        setAuthState({
          checking: false,
          isLocal: data.isLocal,
          authenticated: data.authenticated,
          user: data.user,
          requiresLogin: data.requiresLogin || false
        });
      } catch (error) {
        console.error('Error verificando autenticacion:', error);
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
        setSessionToken(data.sessionToken);
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
    try {
      await authFetch(`${API_BASE}/api/auth/logout`, { method: 'POST' });
    } catch (error) {
      console.error('Error en logout:', error);
    }
    setSessionToken(null);
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
