const module = 'sdl-mgr'; // Module Name

import { load_config, log, ipToInt, intToIp, computeBroadcast, getProcessStartTs, getUptimeDHMS } from '../nwa-lib/index.js';
import mqtt from 'mqtt';
import os from 'os';
import dgram from 'dgram';
import fs from 'fs';
import path from 'path';


const config = load_config();

log(`Loaded module: ${module}`);
// log(`${module}: Cluster Conf: ${JSON.stringify(config.cluster, null, 2)}`, true);
// log(`${module}: Dirs: ${JSON.stringify(config.dirs, null, 2)}`, true);

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
        uptime: getUptimeDHMS(),
        stats: {
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
        }
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
      },
      workers: {}
    };

    fs.writeFileSync(clusterFile, JSON.stringify(initialState, null, 2));
    return initialState;
  }

  // Load existing cluster state
  const data = fs.readFileSync(clusterFile, 'utf8');
  return JSON.parse(data);
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

  //  config.modules.mqtt.topics.sdl-mgr.pub.sdl_cluster-status
  const statusTopic = mqttCfg.topics?.[module]?.pub?.['sdl_cluster-status'];
  if (!statusTopic) {
    log(`${module}: ${statusTopic} not configured`);
    return;
  }

  // This is ok because we are running on localhost
  const mqttUrl = `mqtt://127.0.0.1:${mqttCfg.mqtt_port}`;
  const client = mqtt.connect(mqttUrl);

  client.on('connect', () => {
    log(`${module}: connected to MQTT at ${mqttUrl}`);

    publishStatus(client, statusTopic);
    setInterval(() => publishStatus(client, statusTopic), statusInterval);
  });

  client.on('error', err => {
    log(`${module}: MQTT error: ${err}`);
  });
}

function publishStatus(client, topic) {
  const status = {
    ts: new Date().toISOString(),
    sdl_id: config.identity.sdl_id,
    role: 'sdl-mgr',
    host: config.identity.hostname,
    type: 'cluster-status',
    msg: {
      sdl: {
        version: config.package.version,
        uptime: getUptimeDHMS()
      },
      cluster: config.cluster,
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
      } else {
        log(`${module}: published status to ${topic}`);
      }
    }
  );
}


function startUdpBeacon() {
  let sdlCfg  = config.modules['sdl-mgr'];
  // log(`${module}: DEBUG: SDL config: ${JSON.stringify(sdlCfg, null, 2)}`, true);
  // log(`${module}: DEBUG: Cluster Conf: ${JSON.stringify(config.cluster, null, 2)}`, true);
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

  log(`${module}: DEBUG: cluster: ${JSON.stringify(cluster)}`);
  

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

    // for (const [iface, addrs] of Object.entries(config.host.network)) {
    for (const [iface, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        // --- FILTERS ---

        // IPv4 only
        if (addr.family !== 'IPv4') continue;

        // Skip loopback
        if (addr.internal === true) continue;

        // Skip /32 networks (no broadcast: e.g. Tailscale)
        const cidr = Number(addr.cidr?.split('/')[1]);
        if (!Number.isInteger(cidr) || cidr >= 32) continue;

        // Compute broadcast address
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
              curl: `curl -s http://${addr.address}:${config.modules.web.port}/dist/install-sdl-wkr.sh | bash -s ${addr.address}`,
              wget: `wget -O - http://${addr.address}:${config.modules.web.port}/dist/install-sdl-wkr.sh | bash -s ${addr.address}`
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



// -------------------------------
// Entry point (ESM-safe)
// -------------------------------
startSDLStatusPub();
startUdpBeacon();
loadClusterState(config);