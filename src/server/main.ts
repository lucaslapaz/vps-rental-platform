import 'reflect-metadata';
import { loadEnv } from './config/env.ts';
import { handleSignals, startServer } from './server.ts';

const env = loadEnv();
const { stop, logger } = await startServer({ env, vite: env.NODE_ENV === 'development' });
handleSignals(stop, logger);
