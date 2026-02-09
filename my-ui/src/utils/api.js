// Obtener token de sesion
export const getSessionToken = () => localStorage.getItem('isiprime_session');
export const setSessionToken = (token) => token ? localStorage.setItem('isiprime_session', token) : localStorage.removeItem('isiprime_session');

// Fetch con autenticacion
export const authFetch = async (url, options = {}) => {
  const token = getSessionToken();
  const headers = { ...options.headers };
  if (token) {
    headers['X-Session-Token'] = token;
  }
  return fetch(url, { ...options, headers });
};
