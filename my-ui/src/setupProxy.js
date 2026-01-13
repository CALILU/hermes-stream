const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    createProxyMiddleware('/api', {
      target: 'http://localhost:3001',
      changeOrigin: true,
      secure: false,
      timeout: 60000,  // 60 segundos timeout
      proxyTimeout: 60000
    })
  );

  app.use(
    createProxyMiddleware('/stream', {
      target: 'http://localhost:3001',
      changeOrigin: true,
      secure: false,
      timeout: 120000,  // 2 minutos para streaming
      proxyTimeout: 120000
    })
  );
};
