const module = 'sdl-mgr'; // Module Name

import { load_config, log, ipToInt, intToIp, computeBroadcast, getProcessStartTs, getUptimeDHMS, getUptimeSec } from '../nwa-lib/index.js';
import mqtt from 'mqtt';
import os from 'os';
import dgram from 'dgram';
import fs from 'fs';
import path from 'path';

const config = load_config();

log(`Loaded module: ${module}`);

// ✅ In-memory workers state (built from telemetry only)
let workersState = {};

function loadClusterState(config) {
  const clusterDir = config.dirs.clstr;
  const clusterFile = path.join(clusterDir, 'cluster.json');

  // Ensure cluster directory exists
  if (!fs.existsSync(clusterDir)) {
    fs.mkdirSync(clusterDir, { recursive: true });
  }

  // If cluster.json doesn't exist, create initial state
  if (!fs.existsSync(clusterFile)) {
    const initialState = {
      meta: {
        updated: new Date().toISOString(),
        started_at: new Date(getProcessStartTs()).toISOString(),
        uptime: getUptimeDHMS()
      },
      cluster: config.cluster,
      "sdl-mgr": {
        sdl_id: config.identity.sdl_id,
        hostname: config.identity.hostname,
        platform: config.host.os.platform,
        arch: config.host.cpu.arch,
        distro: config.host.os.pretty_name,
        distro_name: config.host.os.name,
        distro_version: config.host.os.version
      }
    };

    fs.writeFileSync(clusterFile, JSON.stringify(initialState, null, 2));
    return initialState;
  }

  // Load existing cluster state
  const data = fs.readFileSync(clusterFile, 'utf8');
  return JSON.parse(data);
}

function saveClusterState(config, state) {
  const clusterDir = config.dirs.clstr;
  const clusterFile = path.join(clusterDir, 'cluster.json');

  // Update metadata timestamp and uptime
  state.meta.updated = new Date().toISOString();
  state.meta.uptime = getUptimeDHMS();

  // Write to disk
  try {
    fs.writeFileSync(clusterFile, JSON.stringify(state, null, 2));
    // log(`${module}: cluster state saved to ${clusterFile}`);
  } catch (err) {
    log(`${module}: failed to save cluster state: ${err}`);
    throw err;
  }
}

// ✅ Compute stats from in-memory workers state
function computeStats() {
  const stats = {
    workers: {
      allocated: 0,
      available: 0,
      used: 0
    },
    resources: {
      cpus: {
        allocated: 0,
        available: 0,
        used: 0
      },
      memory: {
        allocated: 0,
        available: 0,
        used: 0
      },
      gpus: {
        allocated: 0,
        available: 0,
        used: 0
      }
    }
  };

  // Count workers and aggregate resources
  for (const worker of Object.values(workersState)) {
    stats.workers.allocated++;
    
    if (worker.status === 'active') {
      stats.workers.available++;
      
      stats.resources.cpus.available += worker.resources?.cpus?.available || 0;
      stats.resources.memory.available += worker.resources?.memory?.available || 0;
      stats.resources.gpus.available += worker.resources?.gpus?.available || 0;
    }

    stats.resources.cpus.allocated += worker.resources?.cpus?.allocated || 0;
    stats.resources.cpus.used += worker.usage?.cpu?.total || 0;
    
    stats.resources.memory.allocated += worker.resources?.memory?.allocated || 0;
    stats.resources.memory.used += worker.usage?.memory?.used || 0;
    
    stats.resources.gpus.allocated += worker.resources?.gpus?.allocated || 0;
    stats.resources.gpus.used += worker.usage?.gpu?.total_utilization || 0;
  }

  return stats;
}

//  Worker Join Handler
function startJoinHandler() {
  const sdlCfg = config.modules[module];
  const mqttCfg = config.modules.mqtt;

  if (!sdlCfg?.enabled) {
    log(`${module}: disabled, not starting join handler`);
    return;
  }

  if (!mqttCfg?.enabled) {
    log(`${module}: MQTT disabled, cannot handle joins`);
    return;
  }

  const joinReqTopic = mqttCfg.topics?.[module]?.sub?.['sdl_join-req'];
  const joinAuthzTopic = mqttCfg.topics?.[module]?.pub?.['sdl_join-authz'];

  if (!joinReqTopic || !joinAuthzTopic) {
    log(`${module}: join topics not configured`);
    return;
  }

  const mqttUrl = `mqtt://127.0.0.1:${mqttCfg.mqtt_port}`;
  const client = mqtt.connect(mqttUrl);

  client.on('connect', () => {
    log(`${module}: join handler connected to MQTT at ${mqttUrl}`);

    client.subscribe(joinReqTopic, { qos: 1 }, err => {
      if (err) {
        log(`${module}: failed to subscribe to ${joinReqTopic}: ${err}`);
      } else {
        log(`${module}: subscribed to ${joinReqTopic}`);
      }
    });
  });

  client.on('message', (topic, message) => {
    if (topic !== joinReqTopic) return;

    try {
      const joinReq = JSON.parse(message.toString());
      
      log(`${module}: received join request from ${joinReq.host} (${joinReq.sdl_id})`);

      const workerData = joinReq.msg['sdl-wkr'];
      const workerVersion = workerData?.sdl_version;
      const clusterVersion = config.package.version;
      
      let authorized = false;
      let reason = null;

      if (workerVersion === clusterVersion) {
        authorized = true;
        log(`${module}: worker ${joinReq.host} authorized (version ${workerVersion})`);
      } else {
        authorized = false;
        reason = 'version_mismatch';
        log(`${module}: worker ${joinReq.host} denied - version mismatch (worker: ${workerVersion}, cluster: ${clusterVersion})`);
      }

      // Publish authorization response
      const authzResponse = {
        ts: new Date().toISOString(),
        sdl_id: config.identity.sdl_id,
        role: 'sdl-mgr',
        host: config.identity.hostname,
        type: 'join-authz',
        msg: {
          sdl_id: joinReq.sdl_id,
          authorized: authorized,
          reason: reason
        }
      };

      client.publish(
        joinAuthzTopic,
        JSON.stringify(authzResponse),
        { qos: 1 },
        err => {
          if (err) {
            log(`${module}: failed to publish join authz: ${err}`);
          }
        }
      );

    } catch (err) {
      log(`${module}: failed to process join request: ${err}`);
    }
  });

  client.on('error', err => {
    log(`${module}: join handler MQTT error: ${err}`);
  });
}

function startSDLStatusPub() {
  const sdlCfg = config.modules[module];
  const mqttCfg = config.modules.mqtt;

  if (!sdlCfg?.enabled) {
    log(`${module}: disabled, not publishing status`);
    return;
  }

  if (!mqttCfg?.enabled) {
    log(`${module}: MQTT disabled, cannot publish status`);
    return;
  }

  const statusInterval =
    Number.isInteger(sdlCfg.update_interval.cluster_status) &&
    sdlCfg.update_interval.cluster_status > 0
      ? sdlCfg.update_interval.cluster_status
      : 10000;

  const statusTopic = mqttCfg.topics?.[module]?.pub?.['sdl_cluster-status'];
  if (!statusTopic) {
    log(`${module}: cluster-status topic not configured`);
    return;
  }

  const mqttUrl = `mqtt://127.0.0.1:${mqttCfg.mqtt_port}`;
  const client = mqtt.connect(mqttUrl);

  client.on('connect', () => {
    log(`${module}: status publisher connected to MQTT at ${mqttUrl}`);

    publishStatus(client, statusTopic);
    setInterval(() => publishStatus(client, statusTopic), statusInterval);
  });

  client.on('error', err => {
    log(`${module}: status publisher MQTT error: ${err}`);
  });
}

function publishStatus(client, topic) {
  // Compute stats from in-memory workers
  const stats = computeStats();

  // Get IP for update command
  const interfaces = os.networkInterfaces();
  let ip_addr = null;

  for (const [iface, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family !== 'IPv4') continue;
      if (addr.internal === true) continue;
      
      const cidr = Number(addr.cidr?.split('/')[1]);
      if (!Number.isInteger(cidr) || cidr >= 32) continue;
      
      ip_addr = addr.address;
      break;
    }
    if (ip_addr) break;
  }

  const web_port = config.modules.web.port;

  const status = {
    ts: new Date().toISOString(),
    sdl_id: config.identity.sdl_id,
    role: 'sdl-mgr',
    host: config.identity.hostname,
    type: 'cluster-status',
    msg: {
      sdl: {
        version: config.package.version,
        uptime_secs: getUptimeSec(),
        uptime: getUptimeDHMS(),
        update_cmd: ip_addr 
          ? `curl -s http://${ip_addr}:${web_port}/dist/install-sdl-wkr.sh | bash -s ${ip_addr}:${web_port}`
          : null
      },
      cluster: config.cluster,
      resources: stats.resources,
      workers: stats.workers,
      modules: Object.fromEntries(
        Object.entries(config.modules).map(([name, mod]) => [
          name,
          { enabled: mod?.enabled === true }
        ])
      )
    }
  };

  client.publish(
    topic,
    JSON.stringify(status),
    { qos: 1, retain: true },
    err => {
      if (err) {
        log(`${module}: failed to publish status: ${err}`);
      }
    }
  );
}

// ✅ Publish workers from in-memory state
function startWorkersPub() {
  const sdlCfg = config.modules[module];
  const mqttCfg = config.modules.mqtt;

  if (!sdlCfg?.enabled) {
    log(`${module}: disabled, not publishing workers`);
    return;
  }

  if (!mqttCfg?.enabled) {
    log(`${module}: MQTT disabled, cannot publish workers`);
    return;
  }

  const workersInterval =
    Number.isInteger(sdlCfg.update_interval.cluster_workers) &&
    sdlCfg.update_interval.cluster_workers > 0
      ? sdlCfg.update_interval.cluster_workers
      : 10000;

  const workersTopic = mqttCfg.topics?.[module]?.pub?.['sdl_cluster-workers'];
  if (!workersTopic) {
    log(`${module}: sdl_cluster-workers topic not configured`);
    return;
  }

  const mqttUrl = `mqtt://127.0.0.1:${mqttCfg.mqtt_port}`;
  const client = mqtt.connect(mqttUrl);

  client.on('connect', () => {
    log(`${module}: workers publisher connected to MQTT at ${mqttUrl}`);

    publishWorkers(client, workersTopic);
    setInterval(() => publishWorkers(client, workersTopic), workersInterval);
  });

  client.on('error', err => {
    log(`${module}: workers publisher MQTT error: ${err}`);
  });
}

function publishWorkers(client, topic) {
  const workersMsg = {
    ts: new Date().toISOString(),
    sdl_id: config.identity.sdl_id,
    role: 'sdl-mgr',
    host: config.identity.hostname,
    type: 'cluster-workers',
    msg: {
      workers: workersState  // ✅ Use in-memory state from telemetry
    }
  };

  client.publish(
    topic,
    JSON.stringify(workersMsg),
    { qos: 1, retain: true },
    err => {
      if (err) {
        log(`${module}: failed to publish workers: ${err}`);
      }
    }
  );
}

function startUdpBeacon() {
  let sdlCfg  = config.modules['sdl-mgr'];
  sdlCfg.cluster = config.cluster;
  const mqttCfg = config.modules.mqtt;

  if (!sdlCfg?.enabled) {
    log(`${module}: sdl disabled, not starting UDP beacon`);
    return;
  }

  if (!mqttCfg?.enabled) {
    log(`${module}: mqtt disabled, cannot advertise broker`);
    return;
  }

  const beaconPort =
    Number.isInteger(sdlCfg.beacon_udp_port)
      ? sdlCfg.beacon_udp_port
      : 10101;

  const beaconInterval =
    Number.isInteger(sdlCfg.update_interval.udp_beacon)
      ? sdlCfg.update_interval.udp_beacon
      : 2000;

  const cluster = sdlCfg.cluster || {
    id: 'default',
    name: 'default',
    desc: ''
  };

  log(`${module}: cluster: ${JSON.stringify(cluster)}`);

  if (!config.host?.network) {
    log(`${module}: no host network metadata available for UDP beacon`);
    return;
  }

  const socket = dgram.createSocket('udp4');

  socket.on('error', err => {
    log(`${module}: UDP beacon socket error: ${err}`);
  });

  socket.bind(() => {
    socket.setBroadcast(true);
    log(`${module}: UDP beacon active on port ${beaconPort}`);
  });

  setInterval(() => {
    const interfaces = os.networkInterfaces();

    for (const [iface, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        if (addr.family !== 'IPv4') continue;
        if (addr.internal === true) continue;

        const cidr = Number(addr.cidr?.split('/')[1]);
        if (!Number.isInteger(cidr) || cidr >= 32) continue;

        const broadcastAddr = computeBroadcast(addr.address, addr.netmask);
        if (!broadcastAddr) continue;

        const beacon = {
          ts: new Date().toISOString(),
          sdl_id: config.identity.sdl_id,
          role: 'sdl-mgr',
          host: config.identity.hostname,
          type: 'udp-beacon',
          msg: {
            info: {
              desc: config.package.description,
              version: config.package.version,
              copyright: config.package.copyright
            },
            cluster: {
              id: cluster.id,
              name: cluster.name,
              desc: cluster.desc
            },
            mqtt: {
              host: addr.address,
              port: mqttCfg.mqtt_port
            },
            web: {
              proto: 'http',
              host: addr.address,
              port: config.modules.web.port,
              api_config: '/api/config',
              config_url: `http://${addr.address}:${config.modules.web.port}/api/config`,
              web_ui_url: `http://${addr.address}:${config.modules.web.port}`, 
            },
            sdl_wkr_install_cmd: {
              curl: `curl -s http://${addr.address}:${config.modules.web.port}/dist/install-sdl-wkr.sh | bash -s ${addr.address}:${config.modules.web.port}`,
              wget: `wget -O - http://${addr.address}:${config.modules.web.port}/dist/install-sdl-wkr.sh | bash -s ${addr.address}:${config.modules.web.port}`,
            }
          }
        };

        const payload = Buffer.from(JSON.stringify(beacon)+"\n");

        socket.send(
          payload,
          0,
          payload.length,
          beaconPort,
          broadcastAddr,
          err => {
            if (err) {
              log(`${module}: UDP beacon send error (${broadcastAddr}): ${err}`);
            }
          }
        );
      }
    }
  }, beaconInterval);

  log(
    `${module}: broadcasting UDP beacon every ${beaconInterval}ms on port ${beaconPort}`
  );
}

// ✅ Build workers state from telemetry
function startTelemetryListener() {
  const sdlCfg = config.modules[module];
  const mqttCfg = config.modules.mqtt;

  if (!sdlCfg?.enabled) {
    log(`${module}: disabled, not listening for telemetry`);
    return;
  }

  if (!mqttCfg?.enabled) {
    log(`${module}: MQTT disabled, cannot listen for telemetry`);
    return;
  }

  const telemetryTopic = mqttCfg.topics?.[module]?.sub?.['sdl_cluster-telemetry'];
  if (!telemetryTopic) {
    log(`${module}: cluster-telemetry topic not configured`);
    return;
  }

  const mqttUrl = `mqtt://127.0.0.1:${mqttCfg.mqtt_port}`;
  const client = mqtt.connect(mqttUrl);

  client.on('connect', () => {
    log(`${module}: telemetry listener connected to MQTT at ${mqttUrl}`);

    client.subscribe(telemetryTopic, { qos: 1 }, err => {
      if (err) {
        log(`${module}: failed to subscribe to ${telemetryTopic}: ${err}`);
      } else {
        log(`${module}: subscribed to ${telemetryTopic}`);
      }
    });
  });

  client.on('message', (topic, message) => {
    if (topic !== telemetryTopic) return;

    try {
      const telemetry = JSON.parse(message.toString());
      const sdl_id = telemetry.sdl_id;
      const hostname = telemetry.host;
      const now = new Date();
      
      // ✅ Build/update worker state from telemetry
      workersState[sdl_id] = telemetry

    } catch (err) {
      log(`${module}: failed to process telemetry: ${err}`);
    }
  });

  client.on('error', err => {
    log(`${module}: telemetry listener MQTT error: ${err}`);
  });
}

// ✅ Mark stale workers as inactive
function startStaleWorkerDetection() {
  const sdlCfg = config.modules[module];

  if (!sdlCfg?.enabled) {
    log(`${module}: disabled, not starting stale worker detection`);
    return;
  }

  const checkInterval = 10000;
  
  // Try multiple config locations for stale threshold
  const staleThreshold = 
    sdlCfg.expiration_timeout?.cluster_telemetry ||
    sdlCfg.worker_stale_threshold ||
    30000;

  setInterval(() => {
    const now = Date.now();

    for (const [sdl_id, worker] of Object.entries(workersState)) {
      const lastSeenMs = Date.parse(worker.last_seen);
      const ageMs = now - lastSeenMs;

      if (ageMs > staleThreshold && worker.status === 'active') {
        log(`${module}: worker ${worker.hostname} (${sdl_id}) marked inactive (${Math.round(ageMs / 1000)}s)`);
        workersState[sdl_id].status = 'inactive';
      }
    }
  }, checkInterval);

  log(`${module}: stale worker detection active (threshold: ${staleThreshold}ms, check: ${checkInterval}ms)`);
}

// Entry point
startSDLStatusPub();
startWorkersPub();
startTelemetryListener(); 
startUdpBeacon();
loadClusterState(config);
startJoinHandler();
startStaleWorkerDetection();