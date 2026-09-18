import { startServer } from './apps/server/dist/index.js';
const handle = await startServer(Number(process.env.MJOLNIR_PORT ?? 7845));
console.log(`\n  Mjolnir → http://127.0.0.1:${handle.port}\n`);
