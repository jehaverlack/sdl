const module = 'sdl-wkr'; // Module Name
import { load_config, log, getUptimeDHMS, getOSUptimeDHMS } from '../nwa-lib/index.js';
import dgram from 'dgram';
import mqtt from 'mqtt';
import fs from 'fs';
import os, { platform } from 'os';
import { exec, execSync } from 'child_process';
import { get } from 'http';

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
let telemetryTimer = null; 
let lastCpuInfo = null;

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
          totalmem: os.totalmem(),
          gpus: Array.isArray(config.host.gpu) ? config.host.gpu.length : 0  // ✅ Fixed
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

    // ✅ Start telemetry after authorization
    startTelemetry();
  } else {
    log(`${module}: join denied: ${payload.msg?.reason || 'unknown'}`);
  }
}

// -------------------------------
// Handle cluster status
// -------------------------------
function handleClusterStatus(payload) {
  const clusterVersion = payload.msg?.sdl?.version;
  const updateCmd = payload.msg?.sdl?.update_cmd;
  const localVersion = config.package.version;
  const uptime = payload.msg?.sdl?.uptime_secs;


  if (!clusterVersion) return;

  if (clusterVersion !== localVersion) {
    log(
      `${module}: version mismatch detected (cluster=${clusterVersion}, local=${localVersion})`
    );
    triggerWorkerUpdate(clusterVersion, updateCmd);
  } else if (uptime < 5) { // sld-mgr restarts for Development Testing
    log(
      `${module}: version mismatch detected (cluster=${clusterVersion}, local=${localVersion})`
    );
    triggerWorkerUpdate(clusterVersion, updateCmd);
  }
}

// -------------------------------
// Trigger worker update
// -------------------------------
function triggerWorkerUpdate(targetVersion, updateCmd) {
  if (updating) return;
  updating = true;

  log(
    `${module}: triggering self-update to SDL version ${targetVersion}`
  );

  // Stop reacting to further control messages
  authorized = false;
  
  // ✅ Stop telemetry during update
  stopTelemetry();

  try {
    exec(updateCmd, { stdio: 'inherit' });
  } catch (err) {
    log(`${module}: failed to exec update command: ${err}`);
    return;
  }
}

// -------------------------------
// ✅ Worker Telemetry
// -------------------------------
function startTelemetry() {
  if (telemetryTimer) {
    clearInterval(telemetryTimer);
  }

  const telemetryInterval =
    Number.isInteger(config.modules[module].update_interval?.worker_telemetry) &&
    config.modules[module].update_interval.worker_telemetry > 0
      ? config.modules[module].update_interval.worker_telemetry
      : 5000;  // Default 5 seconds

  const mqttTopics = clusterConfig.modules.mqtt.topics[module];
  const telemetryTopic = mqttTopics.pub['sdl_cluster-telemetry'];

  if (!telemetryTopic) {
    log(`${module}: cluster-telemetry topic not configured`);
    return;
  }

  log(`${module}: starting telemetry (interval: ${telemetryInterval}ms)`);

  // Publish immediately
  publishTelemetry(telemetryTopic);

  // Then publish periodically
  telemetryTimer = setInterval(() => {
    publishTelemetry(telemetryTopic);
  }, telemetryInterval);
}

// Add this function for per-CPU usage
function getPerCPUUsage() {
  const cpus = os.cpus();
  
  if (!lastCpuInfo || !lastCpuInfo.perCpu) {
    // First call - initialize
    const perCpu = cpus.map(cpu => {
      let total = 0;
      for (let type in cpu.times) {
        total += cpu.times[type];
      }
      return {
        idle: cpu.times.idle,
        total: total
      };
    });
    
    lastCpuInfo = lastCpuInfo || {};
    lastCpuInfo.perCpu = perCpu;
    
    return cpus.map(() => 0); // Return 0% for all CPUs on first call
  }
  
  // Calculate per-CPU usage
  const usage = cpus.map((cpu, i) => {
    let total = 0;
    for (let type in cpu.times) {
      total += cpu.times[type];
    }
    
    const idleDelta = cpu.times.idle - lastCpuInfo.perCpu[i].idle;
    const totalDelta = total - lastCpuInfo.perCpu[i].total;
    
    const cpuUsage = 100 - (100 * idleDelta / totalDelta);
    
    // Update stored values
    lastCpuInfo.perCpu[i] = {
      idle: cpu.times.idle,
      total: total
    };
    
    return Math.max(0, Math.min(100, Math.round(cpuUsage)));
  });
  
  return usage;
}

// Update getCPUUsagePercent to calculate average from per-CPU
function getCPUUsagePercent() {
  const perCpuUsage = getPerCPUUsage();
  if (perCpuUsage.length === 0) return 0;
  
  const total = perCpuUsage.reduce((sum, usage) => sum + usage, 0);
  return Math.round(total / perCpuUsage.length);
}

// -------------------------------
// Publish telemetry
// -------------------------------
function publishTelemetry(topic) {
  if (!mqttClient || !authorized) return;

  const gpuCount = Array.isArray(config.host.gpu) ? config.host.gpu.length : 0;
  
  // Get real-time memory usage
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  
  // Get CPU usage
  const perCpuUsage = getPerCPUUsage();
  // const totalCpuUsage = getCPUUsagePercent();
  const totalCpuUsage = perCpuUsage.length > 0
    ? Math.round(perCpuUsage.reduce((sum, usage) => sum + usage, 0) / perCpuUsage.length)
    : 0;

  const telemetry = {
    ts: new Date().toISOString(),
    sdl_id: config.identity.sdl_id,
    role: 'sdl-wkr',
    host: config.identity.hostname,
    type: 'worker-telemetry',
    msg: {
      system: {
        platform: config.host.os.platform,
        arch: config.host.cpu.arch,
        distro: config.host.os.pretty_name,
        distro_name: config.host.os.name,
        distro_version: config.host.os.version,
        hardware: getSystemHardware()
      },
      uptime: {
        process: Math.floor(process.uptime()),
        proc_dhms: getUptimeDHMS(),
        system: Math.floor(os.uptime()),
        sys_dhms: getOSUptimeDHMS()
      },
      resources: {
        cpus: {
          allocated: config.host.cpu.cores_logical,
          available: config.host.cpu.cores_logical
        },
        memory: {
          allocated: totalMem
        },
        gpus: {
          allocated: gpuCount,
          available: gpuCount
        }
      },
      usage: {
        cpu: {
          total: totalCpuUsage,
          per_core: perCpuUsage
        },
        memory: {
          total: totalMem,
          used: usedMem,
          free: freeMem,
          percent_used: Math.round((usedMem / totalMem) * 100)
        },
        gpu: getGPUUsage()
      },
      load: {
        1: os.loadavg()[0],
        5: os.loadavg()[1],
        15: os.loadavg()[2]
      }
    }
  };

  mqttClient.publish(
    topic,
    JSON.stringify(telemetry),
    { qos: 1 },
    err => {
      if (err) {
        log(`${module}: failed to publish telemetry: ${err}`);
      }
    }
  );
}


// Add GPU telemetry function (exec-based)
function getGPUUsage() {
  const gpuCount = Array.isArray(config.host.gpu) ? config.host.gpu.length : 0;
  
  if (gpuCount === 0) {
    return {};
  }
  
  try {
    // Try nvidia-smi for NVIDIA GPUs
    const output = execSync(
      'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits',
      { encoding: 'utf8', timeout: 5000 }
    ).toString();
    
    const lines = output.trim().split('\n');
    const gpus = lines.map((line, index) => {
      const [util, memUsed, memTotal] = line.split(',').map(v => parseInt(v.trim()));
      return {
        id: index,
        utilization: util,
        memory_used_mb: memUsed,
        memory_total_mb: memTotal,
        memory_percent: Math.round((memUsed / memTotal) * 100)
      };
    });
    
    // Calculate totals
    const totalUtil = Math.round(gpus.reduce((sum, gpu) => sum + gpu.utilization, 0) / gpus.length);
    const totalMemUsed = gpus.reduce((sum, gpu) => sum + gpu.memory_used_mb, 0);
    const totalMemTotal = gpus.reduce((sum, gpu) => sum + gpu.memory_total_mb, 0);
    
    return {
      count: gpus.length,
      total_utilization: totalUtil,
      total_memory_used_mb: totalMemUsed,
      total_memory_total_mb: totalMemTotal,
      total_memory_percent: Math.round((totalMemUsed / totalMemTotal) * 100),
      gpus: gpus
    };
  } catch (err) {
    // nvidia-smi not available or failed
    return { error: 'unavailable' };
  }
}



function getSystemHardware() {
  const hardware = {
    type: 'unknown',
    manufacturer: 'Unknown',
    model: 'Unknown'
  };

  // Only run Linux-specific detection on Linux
  if (config.host.os.platform !== 'linux') {
    return hardware;
  }

  // === Linux-specific detection below ===

  // Check for Raspberry Pi FIRST
  try {
    const piModel = fs.readFileSync('/proc/device-tree/model', 'utf8')
      .replace(/\0/g, '')
      .replace(/Raspberry Pi/, '')
      .trim();
    
    if (piModel) {
      hardware.type = 'hw';  // ✅ Changed from 'physical'
      hardware.manufacturer = 'Raspberry Pi';
      hardware.model = piModel;
      return hardware;
    }
  } catch (err) {
    // Not a Pi, continue
  }

  // Check for hypervisor flag
  try {
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    if (cpuinfo.includes('hypervisor')) {
      hardware.type = 'vm';
      
      // Detect hypervisor type from DMI
      try {
        const manufacturer = fs.readFileSync('/sys/class/dmi/id/sys_vendor', 'utf8').trim();
        const product = fs.readFileSync('/sys/class/dmi/id/product_name', 'utf8').trim();
        
        hardware.manufacturer = manufacturer;
        
        // Set model to hypervisor type
        if (manufacturer.includes('QEMU') || product.includes('KVM')) {
          hardware.model = 'KVM';
        } else if (manufacturer.includes('VMware')) {
          hardware.model = 'VMware';
        } else if (manufacturer.includes('innotek')) {
          hardware.model = 'VirtualBox';
        } else if (manufacturer.includes('Microsoft')) {
          hardware.model = 'Hyper-V';
        } else if (manufacturer.includes('Xen')) {
          hardware.model = 'Xen';
        } else {
          hardware.model = 'Unknown VM';
        }
        
        return hardware;
      } catch (err) {
        hardware.manufacturer = 'Unknown';
        hardware.model = 'Unknown VM';
        return hardware;
      }
    }
  } catch (err) {
    // Can't read cpuinfo
  }

  // No hypervisor flag - likely physical, get DMI info
  try {
    const manufacturer = fs.readFileSync('/sys/class/dmi/id/sys_vendor', 'utf8').trim();
    const product = fs.readFileSync('/sys/class/dmi/id/product_name', 'utf8').trim();

    hardware.type = 'hw';  // ✅ Changed from 'physical'
    hardware.manufacturer = manufacturer;
    hardware.model = product;

    return hardware;
  } catch (err) {
    // DMI not available
  }

  return hardware;
}

function stopTelemetry() {
  if (telemetryTimer) {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
    log(`${module}: telemetry stopped`);
  }
}

// -------------------------------
// Entry point
// -------------------------------
startUdpListener();