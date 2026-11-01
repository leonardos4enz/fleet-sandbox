import { createServer } from 'node:http';
import { app } from './app.js';

const port = Number(process.env['PORT'] ?? 3000);
createServer(app).listen(port);
