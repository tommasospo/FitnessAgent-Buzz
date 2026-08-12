// Config pm2 — stesso file funziona qui sul Mac oggi e su Hetzner domani.
// `pm2 start ecosystem.config.cjs` dalla cartella bot/.
module.exports = {
  apps: [
    {
      name: 'buzz-bot-pt',
      script: 'node',
      args: '--env-file=.env.pt --import tsx src/index.ts',
      cwd: __dirname,
      env: {},
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
    },
    {
      name: 'buzz-bot-nutrizionista',
      script: 'node',
      args: '--env-file=.env.nutrizionista --import tsx src/index.ts',
      cwd: __dirname,
      env: {},
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
    },
  ],
}
