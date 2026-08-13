import { createApp } from './app.js';
import { getConfig } from './config.js';
import { createJsonStore } from './store.js';

const config = getConfig();
const store = createJsonStore(config);

await store.initialize();

const server = createApp({ store });

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`El puerto ${config.port} ya está ocupado. Cierra el backend anterior o configura PROTOTYPE_PORT.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  console.log(`ELEVANT backend prototipo: http://localhost:${config.port}`);
  console.log(`Estado del servicio: http://localhost:${config.port}/health`);
  console.log(`Persistencia local: ${store.runtimePath}`);
});
