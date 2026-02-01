const module = 'sdl-wkr'; // Module Name
import { load_config, log } from '../nwa-lib/index.js';
import dgram from 'dgram';
import mqtt from 'mqtt';
import os from 'os';
import { exec } from 'child_process';


const config = load_config();

log(`Loaded module: ${module}`);

// -------------------------------
// Worker state
// -------------------------------
let joined = false;
let authorized = false;
let mqttClient = null;
let clusterConfig = null;
let updating = false;

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

      if (beacon?.type !== 'udp-beacon') return;
      if (beacon?.msg?.cluster?.id == null) return;
      if (beacon?.msg?.mqtt?.host == null) return;

      log(`${module}: received SDL beacon from ${rinfo.address}`);

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
async function handleBeacon(beacon) {
  const beaconMsg = beacon.msg;
  const mqttInfo = beaconMsg.mqtt;
  const cluster = beaconMsg.cluster;

  // Optional: If cluster_id is configured, validate it. Otherwise auto-join first beacon.
  const expectedClusterId = config.modules[module].cluster_id;
  if (expectedClusterId && cluster.id !== expectedClusterId) {
    log(`${module}: ignoring beacon for cluster ${cluster.id}`);
    return;
  }

  log(`${module}: cluster '${cluster.name}' discovered via ${beacon.host}`);

  // Fetch full cluster config from API
  const configUrl = beaconMsg.web.config_url;
  try {
    const response = await fetch(configUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    clusterConfig = await response.json();
    log(`${module}: fetched cluster config from ${configUrl}`);
  } catch (err) {
    log(`${module}: failed to fetch cluster config: ${err}`);
    return;
  }

  log(`${module}: joining cluster '${cluster.name}' via MQTT ${mqttInfo.host}:${mqttInfo.port}`);

  joinCluster(mqttInfo, cluster);
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

    const mqttTopics = clusterConfig.modules.mqtt.topics[module];
    
    // Subscribe to authz topic
    const authzTopic = mqttTopics.sub['sdl_join-authz'];
    mqttClient.subscribe(authzTopic, { qos: 1 }, err => {
      if (err) {
        log(`${module}: failed to subscribe to ${authzTopic}: ${err}`);
      } else {
        log(`${module}: subscribed to ${authzTopic}`);
      }
    });

    const joinTopic = mqttTopics.pub['sdl_join-req'];
    
    const joinPayload = {
      ts: new Date().toISOString(),
      sdl_id: config.identity.sdl_id,
      role: 'sdl-wkr',
      host: config.identity.hostname,
      type: 'join-request',
      msg: {
        cluster_id: cluster.id,
        "sdl-wkr": {
          sdl_id: config.identity.sdl_id,
          hostname: config.identity.hostname,
          sdl_version: config.package.version,
          platform: config.host.os.platform,
          arch: config.host.cpu.arch,
          distro: config.host.os.pretty_name,
          distro_name: config.host.os.name,
          distro_version: config.host.os.version,
          cpus: os.cpus().length,
          totalmem: os.totalmem()
        }
      }
    };

    mqttClient.publish(
      joinTopic,
      JSON.stringify(joinPayload),
      { qos: 1 },
      err => {
        if (err) {
          log(`${module}: failed to publish join request: ${err}`);
        } else {
          log(`${module}: published join request to ${joinTopic}`);
        }
      }
    );
  });

  mqttClient.on('message', (topic, message) => {
    handleMqttMessage(topic, message);
  });

  mqttClient.on('error', err => {
    log(`${module}: MQTT error: ${err}`);
  });
}

// -------------------------------
// Handle MQTT messages
// -------------------------------
function handleMqttMessage(topic, message) {

  try {
    const payload = JSON.parse(message.toString());
    const mqttTopics = clusterConfig.modules.mqtt.topics[module];
    
  if (topic === mqttTopics.sub['sdl_join-authz']) {
    handleJoinAuthz(payload);
    return;
  }

  if (
    authorized &&
    topic === mqttTopics.sub['sdl_cluster-status']
  ) {
    handleClusterStatus(payload);
  }

  } catch (err) {
    log(`${module}: failed to parse MQTT message: ${err}`);
  }
}

// -------------------------------
// Handle join authorization
// -------------------------------
function handleJoinAuthz(payload) {
  // Check if this authz is for us
  if (payload.msg?.sdl_id !== config.identity.sdl_id) {
    return;
  }

  if (payload.msg?.authorized === true) {
    log(`${module}: join authorized by cluster`);
    authorized = true;

    const mqttTopics = clusterConfig.modules.mqtt.topics[module];
    const statusTopic = mqttTopics.sub['sdl_cluster-status'];

    mqttClient.subscribe(statusTopic, { qos: 1 }, err => {
      if (err) {
        log(`${module}: failed to subscribe to ${statusTopic}: ${err}`);
      } else {
        log(`${module}: subscribed to ${statusTopic}`);
      }
    });
  } else {
    log(`${module}: join denied: ${payload.msg?.reason || 'unknown'}`);
  }
}

function handleClusterStatus(payload) {
  const clusterVersion = payload.msg?.sdl?.version;
  const updateCmd = payload.msg?.sdl?.update_cmd;
  const localVersion = config.package.version;

  if (!clusterVersion) return;

  if (clusterVersion !== localVersion) {
    log(
      `${module}: version mismatch detected (cluster=${clusterVersion}, local=${localVersion})`
    );
    triggerWorkerUpdate(clusterVersion, updateCmd);
  }
}


function triggerWorkerUpdate(targetVersion, updateCmd) {
  if (updating) return;
  updating = true;

  log(
    `${module}: triggering self-update to SDL version ${targetVersion}`
  );

  // Stop reacting to further control messages
  authorized = false;

  try {
    exec(updateCmd, { stdio: 'inherit' });
  } catch (err) {
    log(`${module}: failed to exec update command: ${err}`);
    return;
  }
}



// -------------------------------
// Entry point
// -------------------------------
startUdpListener();