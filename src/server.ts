import express from 'express';
import WebSocket from 'ws';
import http from 'http';
import { setupWSConnection } from './yjs/utils';

const host = process.env.HOST || 'localhost';
const port = process.env.PORT || 1234;

const wss = new WebSocket.Server({ noServer: true });

const app = express();

const server = http.createServer(app);

wss.on('connection', setupWSConnection);

server.on('upgrade', (request, socket, head) => {
  const handleAuth = (ws: any) => {
    wss.emit('connection', ws, request);
  };
  wss.handleUpgrade(request, socket, head, handleAuth);
});

server.listen(port, host as any, () => {
  console.log(`running at '${host}' on port ${port}`);
});
