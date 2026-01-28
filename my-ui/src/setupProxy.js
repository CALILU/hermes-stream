const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    createProxyMiddleware('/api', {
      target: 'http://localhost:4000',
      changeOrigin: true,
      secure: false,
      timeout: 600000,  // 10 minutos timeout (para enriquecer ~600 películas)
      proxyTimeout: 600000
    })
  );

  app.use(
    createProxyMiddleware('/stream', {
      target: 'http://localhost:4000',
      changeOrigin: true,
      secure: false,
      timeout: 120000,  // 2 minutos para streaming
      proxyTimeout: 120000
    })
  );
};
