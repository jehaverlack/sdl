const module = 'mqtt'; // Module Name
import { load_config, log } from '../nwa-lib/index.js';
const config = load_config();

log(`Loaded module: ${module}`);

// log(`${module}: JSON.stringify(config.modules[module]): ${JSON.stringify(config.modules[module], null, 2)}`);

import aedes from 'aedes';
import net from 'net';
import http from 'http';
import websocketStream from 'websocket-stream';

const broker = aedes();

const port = {
    "mqtt": config.modules[module].mqtt_port,
    "ws": config.modules[module].ws_port
}

const bindAddrs =
  Array.isArray(config.modules[module].bind_ip_addrs) &&
  config.modules[module].bind_ip_addrs.length > 0
    ? config.modules[module].bind_ip_addrs
    : ['0.0.0.0'];

if (!Number.isInteger(port.mqtt) || !Number.isInteger(port.ws)) {
  throw new Error(`${module}: invalid port configuration`);
}


// ---- TCP MQTT (1883) ----
for (const addr of bindAddrs) {
  const tcpServer = net.createServer(broker.handle);

  tcpServer.listen(port.mqtt, addr, () => {
    // log(`${module}: INFO: MQTT TCP broker listening on ${addr}:${port.mqtt}`, true);
  });
}
// IP's for TCP MQTT
for (const addr of bindAddrs) {
  if (addr === '0.0.0.0') {
    for (const ip of config.host.ips) {
      log(`${module}: INFO: MQTT TCP broker listening on ${ip}:${port.mqtt}`, true);
    }
  } else {
    log(`${module}: INFO: MQTT TCP broker listening on ${addr}:${port.mqtt}`, true);
  }
}


// ---- WebSocket MQTT (9001) ----
// ---- WebSocket MQTT (9001) ----
for (const addr of bindAddrs) {
  const httpServer = http.createServer();

  websocketStream.createServer(
    { server: httpServer },
    broker.handle
  );

  httpServer.listen(port.ws, addr, () => {
    if (addr === '0.0.0.0') {
      for (const ip of config.host.ips) {
        log(`${module}: INFO: MQTT WS broker listening on ${ip}:${port.ws}`, true);
      }
    } else {
      log(`${module}: INFO: MQTT WS broker listening on ${addr}:${port.ws}`, true);
    }
  });
}



// ---- Logging (optional but useful) ----
broker.on('client', (client) => {
//   console.log('Client connected:', client?.id);
  log(`${module}: Client connected: ${client?.id}`);
});

broker.on('clientDisconnect', (client) => {
//   console.log('Client disconnected:', client?.id);
  log(`${module}: Client disconnected: ${client?.id}`);
});

broker.on('publish', (packet, client) => {
  if (client) {
    // console.log(
    //   `Publish from ${client.id}: ${packet.topic}`
    // );
    // log(`${module}: Publish from ${client.id}: ${packet.topic}`);
  }
});
