const module = 'sdl-wkr'; // Module Name
import { load_config, log } from '../nwa-lib/index.js';
import dgram from 'dgram';
import mqtt from 'mqtt';
import os from 'os';

const config = load_config();

log(`Loaded module: ${module}`);

// log(`${module}: CONFIG: ${JSON.stringify(config, null, 2)}`, true);

// -------------------------------
// Worker state
// -------------------------------
let joined = false;
let mqttClient = null;

// -------------------------------
// Start UDP discovery
// -------------------------------
function startUdpListener() {
  if (!config.modules?.[module]?.enabled) {
    log(`${module}: disabled, not starting UDP listener`);
    return;
  }

  const udpPort = config.modules[module]['sdl-mgr-udp-port'];
  if (!Number.isInteger(udpPort)) {
    log(`${module}: sdl-mgr-udp-port not configured`);
    return;
  }

  const socket = dgram.createSocket('udp4');

  socket.on('error', err => {
    log(`${module}: UDP socket error: ${err}`);
  });

  socket.on('message', (msg, rinfo) => {
    if (joined) return;

    try {
      const beacon = JSON.parse(msg.toString());

      if (beacon?.sdl?.cluster?.id == null) return;
      if (beacon?.sdl?.mqtt?.host == null) return;

      log(`${module}: received SDL beacon from ${rinfo.address}`);
      log(`${module}: UDP beacon: ${JSON.stringify(beacon)}`, false);

      handleBeacon(beacon);
    } catch {
      // ignore garbage
    }
  });

  socket.bind(udpPort, '0.0.0.0', () => {
    socket.setBroadcast(true);
    log(`${module}: listening for SDL beacons on UDP ${udpPort}`);
  });
}

// -------------------------------
// Handle beacon
// -------------------------------
function handleBeacon(beacon) {
  const sdl = beacon.sdl;
  const mqttInfo = sdl.mqtt;

  // Cluster match (strict)
  const expectedClusterId =
    config.modules[module].cluster_id || sdl.cluster.id;

  if (sdl.cluster.id !== expectedClusterId) {
    log(
      `${module}: ignoring beacon for cluster ${sdl.cluster.id}`
    );
    return;
  }

  log(
    `${module}: joining cluster '${sdl.cluster.name}' via MQTT ${mqttInfo.host}:${mqttInfo.port}`
  );

  joinCluster(mqttInfo, sdl.cluster);
}

// -------------------------------
// Join cluster via MQTT
// -------------------------------
function joinCluster(mqttInfo, cluster) {
  joined = true;

  const mqttUrl = `mqtt://${mqttInfo.host}:${mqttInfo.port}`;
  mqttClient = mqtt.connect(mqttUrl);

  mqttClient.on('connect', () => {
    log(`${module}: connected to MQTT broker at ${mqttUrl}`);

    const joinPayload = {
      type: 'sdl_worker_join',
      timestamp: new Date().toISOString(),
      sdl_wkr: config.identity.hostname,
      sdl_id: config.identity.sdl_id
    };

    mqttClient.publish(
      mqttInfo.join_topic,
      JSON.stringify(joinPayload),
      { qos: 1 },
      err => {
        if (err) {
          log(`${module}: failed to publish join message: ${err}`);
        } else {
          log(`${module}: published join request to ${mqttInfo.join_topic}`);
        }
      }
    );
  });

  mqttClient.on('error', err => {
    log(`${module}: MQTT error: ${err}`);
  });
}

// -------------------------------
// Entry point
// -------------------------------
startUdpListener();
