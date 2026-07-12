const fs = require('fs');
const path = require('path');

// Load .env file manually
const envPath = path.join(__dirname, '.env');
const envVars = {};
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      envVars[key] = val;
    }
  }
}

module.exports = {
  apps: [
    {
      name: 'iracing-ai-web',
      script: '.next/standalone/server.js',
      cwd: '/opt/iracing-ai-assistant',
      env: { ...envVars, NODE_ENV: 'production', PORT: 3000, HOSTNAME: '127.0.0.1' },
      instances: 1,
      max_memory_restart: '512M',
      max_restarts: 5,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'iracing-ai-worker',
      script: 'npx',
      args: 'tsx worker/index.ts',
      cwd: '/opt/iracing-ai-assistant',
      env: { ...envVars, NODE_ENV: 'production' },
      instances: 1,
      max_memory_restart: '256M',
      max_restarts: 5,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
