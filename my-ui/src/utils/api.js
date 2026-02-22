// JWT Token management
// Access token in memory (not localStorage for security)
// Refresh token in localStorage (long-lived, needed across page reloads)

let accessToken = null;

export const getRefreshToken = () => localStorage.getItem('isiprime_refresh_token');
export const setRefreshToken = (token) => token ? localStorage.setItem('isiprime_refresh_token', token) : localStorage.removeItem('isiprime_refresh_token');

export const getAccessToken = () => accessToken;
export const setAccessToken = (token) => { accessToken = token; };

// Keep backward compat exports (some components may still reference these)
export const getSessionToken = getRefreshToken;
export const setSessionToken = (token) => {
  // Legacy compat: if called with a session token, ignore
  // New code should use setAccessToken + setRefreshToken
};

// Fetch with JWT auth and auto-refresh
export const authFetch = async (url, options = {}) => {
  const headers = { ...options.headers };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response = await fetch(url, { ...options, headers });

  // If 401 and we have a refresh token, try to refresh
  if (response.status === 401 && getRefreshToken()) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      // Retry the original request with new token
      headers['Authorization'] = `Bearer ${accessToken}`;
      response = await fetch(url, { ...options, headers });
    }
  }

  return response;
};

// Refresh the access token using the refresh token
async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (response.ok) {
      const data = await response.json();
      accessToken = data.accessToken;
      setRefreshToken(data.refreshToken);
      return true;
    } else {
      // Refresh token expired or invalid — clear everything
      accessToken = null;
      setRefreshToken(null);
      return false;
    }
  } catch (error) {
    console.error('Error refreshing token:', error);
    return false;
  }
}
