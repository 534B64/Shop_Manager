import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = await buildApp({ logger: true });

// In production the same process serves the built client — one container, one port.
if (process.env.NODE_ENV === 'production') {
  await app.register(fastifyStatic, { root: path.join(here, '..', 'dist') });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.code(404).send({ error: 'Not found' });
    } else {
      reply.sendFile('index.html'); // SPA fallback
    }
  });
}

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
