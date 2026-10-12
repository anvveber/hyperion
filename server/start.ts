/*
 * Production entry point: starts the location server when LOCATION_PORT is set,
 * then the Next.js standalone server, in the same process. Built to start.js
 * by the Dockerfile.
 */
import { startLocationServer } from './location-server';

startLocationServer();
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the Next.js standalone server is plain CommonJS next to this file
require('./server.js');
