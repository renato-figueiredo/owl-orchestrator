import { loadConfig } from '@owl/core';
import { buildApp } from './app.js';

const config = loadConfig();
const app = buildApp();

app
  .listen({ host: config.host, port: config.port })
  .then(() => console.log(`owl server listening on http://${config.host}:${config.port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
