// PM2 Ecosystem Configuration for LincStation N2
// Usage: pm2 start ecosystem.config.js
//
// Nota: fork mode (1 instancia) porque SQLite no soporta bien
// escrituras concurrentes desde múltiples procesos cluster.
// Para 5-10 usuarios, un solo proceso Node.js es suficiente.
module.exports = {
  apps: [{
    name: 'isiprime',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 8080
    },
    // Logs
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
    // Restart policy
    max_memory_restart: '500M',
    restart_delay: 3000,
    max_restarts: 10,
    // Watch (disabled in production)
    watch: false
  }]
};
