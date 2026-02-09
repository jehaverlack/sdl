// ===============================
// SDL Dashboard MQTT Client
// ===============================
import { getConfig } from './weblib.js';

const config = await getConfig();
// console.log('config:', JSON.stringify(config, null, 2));

let mqttClient = null;
let mqttConfig = null;
let sdlConfig = null;
let lastSdlStatus = null;
let lastSdlTimestamp = null;
let statusCheckTimer = null;
const STALE_GRACE_MS = 2000;
let lastWorkers = null;

// -------------------------------
// GPU Summary (for dashboard)
// -------------------------------
let gpuSummary = 'None';

if (Array.isArray(config.host.gpu) && config.host.gpu.length > 0) {
  gpuSummary = config.host.gpu.map(gpu => {
    const displayName =
      gpu.vendor === 'nvidia'
        ? `NVIDIA ${shortGpuName(gpu)}`
        : `Intel ${shortGpuName(gpu)}`;

    const fullName = gpu.model;

    let memLabel = '';
    // if (gpu.memory?.type === 'dedicated' && gpu.memory.total_mb) {
    if (
      gpu.memory?.type === 'dedicated' &&
      Number.isFinite(gpu.memory.total_mb)
    ) {
      memLabel = `(<span class="dash-val">${Math.round(gpu.memory.total_mb / 1024)}</span> GB VRAM)`;
    } else if (gpu.memory?.type === 'shared') {
      memLabel = '(shared VRAM)';
    } else {
      console.log('ERR: gpu.memory:', JSON.stringify(gpu.memory));
    }

    return `
      <span
        style="font-size:0.8em; cursor:help"
        title="${fullName}">
        ${displayName} ${memLabel}
      </span>
    `;
  }).join('<br>');
}

// Hostinfo: hostname, cpu, cores, ram, os
const hostinfo = {
    "sdl_id": '<span class="dash-val" style=" font-size:0.8em">' + config.identity.sdl_id + '</span>',
    "hostname": '<span class="dash-val">' + config.host.hostname + '</span>',
    // "cpu cores": '<span class="dash-val">' + config.host.cpu.cores_logical + '</span> <span style="font-size:0.7em">' + config.host.cpu.model + '</span>',
    // // "cores": config.host.cpu.cores_logical,
    // "ram": '<span class="dash-val">' + config.host.memory.total_gb + '</span> GB ',
    // "gpu": gpuSummary,
    // "net": "",
    // "os": config.host.os.pretty_name
}


for (let intf in config.host.network) {
    // console.log(intf, JSON.stringify(config.host.network[intf], null, 2));
    if (intf != 'lo') {
      for (let addr in config.host.network[intf]) {
        if (config.host.network[intf][addr].family == 'IPv4') {
          hostinfo["net"] += '<span class="dash-val" style=" font-size: 0.9em">' + config.host.network[intf][addr].cidr + '</span>  ';
        }
      }
    }    
} 


let host_html = '<h5>Manager</h5>\n';
host_html += '<table class="table table-sm table-striped">\n';

host_html += '<tbody>\n';

for (let key in hostinfo) {
    host_html += '<tr>\n';
    host_html += '<td><b>' + key + '</b></td>\n';
    host_html += '<td>' + hostinfo[key] + '</td>\n';
    host_html += '</tr>\n';
}

host_html += '</tbody>\n';
host_html += '</table>\n';

// document.getElementById('dash-sdl-mgr-info').innerHTML = host_html;

initMqtt();

// function shortGpuName(gpu) {
//   let name = gpu.model;

//   // Strip vendor boilerplate
//   name = name
//     .replace(/^NVIDIA Corporation\s+/i, '')
//     .replace(/^Intel Corporation\s+/i, '');

//   // NVIDIA cleanup
//   if (gpu.vendor === 'nvidia') {
//     name = name.replace(/^GeForce\s+/i, 'RTX ');
//   }

//   // Intel cleanup
//   if (gpu.vendor === 'intel') {
//     name = name.replace(/\s*\[.*?\]\s*/g, '');
//   }

//   return name.trim();
// }

function shortGpuName(gpu) {
  const full = gpu.model;

  // NVIDIA: extract RTX/GTX number from brackets
  if (gpu.vendor === 'nvidia') {
    const m = full.match(/\[(?:GeForce\s+)?(RTX|GTX)\s+(\d+)/i);
    if (m) {
      return `${m[1].toUpperCase()} ${m[2]}`;
    }
    // fallback
    return 'NVIDIA GPU';
  }

  // Intel: strip bracketed suffix, keep platform
  if (gpu.vendor === 'intel') {
    return full
      .replace(/^Intel Corporation\s+/i, '')
      .replace(/\s*\[.*?\]\s*/g, '')
      .trim();
  }

  return full;
}

async function initMqtt() {
  // 1) Load config (no cache – must be authoritative)
//   const res = await fetch('/api/config', { cache: 'no-store' });
//   const config = await res.json();

  mqttConfig = config.modules?.mqtt;
  sdlConfig  = config.modules?.['sdl-mgr'];
//   console.log('config:', JSON.stringify(config.modules, null, 2));
//   console.log('MQTT config:', JSON.stringify(mqttConfig, null, 2));
//   console.log('SDL config:', JSON.stringify(sdlConfig, null, 2));

  // 2) Hard requirement: embedded MQTT must be enabled
  if (!mqttConfig) {
    throw new Error('MQTT module not defined in config');
  }

  if (mqttConfig.enabled !== true) {
    throw new Error('MQTT module is disabled; dashboard requires MQTT');
  }

  if (!mqttConfig.ws_port) {
    throw new Error('MQTT ws_port not configured');
  }

  if (!mqttConfig.topics?.['sdl-web']?.sub?.['sdl_cluster-status']) {
    throw new Error('MQTT topic sdl_status not configured');
  }

//   console.log('MQTT config:', JSON.stringify(mqttConfig, null, 2));
//   console.log('SDL config:', JSON.stringify(sdlConfig, null, 2));

  // 3) Derive broker WS URL from page origin
  const wsProto =
    window.location.protocol === 'https:' ? 'wss' : 'ws';

  const wsHost = window.location.hostname;
  // const wsHost =
  //   mqttConfig.ws_host
  //   ?? config.host.ips.find(ip => ip !== '127.0.0.1')
  //   ?? window.location.hostname;

  const wsPort = mqttConfig.ws_port;

  const wsUrl = `${wsProto}://${wsHost}:${wsPort}`;

  console.log('Connecting to embedded MQTT broker:', wsUrl);

  // 4) Connect (IMPORTANT: force path '/')
  mqttClient = mqtt.connect(wsUrl, {
    path: '/',
    reconnectPeriod: 2000,
    connectTimeout: 5000
  });

  // 5) Register handlers
    mqttClient.on('connect', () => {
    console.log('MQTT connected (dashboard)');

    const statusTopic = mqttConfig.topics['sdl-web'].sub['sdl_cluster-status'];
    const workersTopic = mqttConfig.topics['sdl-web'].sub['sdl_cluster-workers'];
    
    console.log('Subscribing to:', statusTopic);
    console.log('Subscribing to:', workersTopic);

    mqttClient.subscribe(statusTopic, { qos: 1 }, err => {
      if (err) {
        console.error('MQTT subscribe error (status):', err);
      } else {
        console.log('Subscribed to', statusTopic);
      }
    });

    mqttClient.subscribe(workersTopic, { qos: 1 }, err => {
      if (err) {
        console.error('MQTT subscribe error (workers):', err);
      } else {
        console.log('Subscribed to', workersTopic);
      }
    });

    startStatusAgeMonitor();
  });

  mqttClient.on('message', (topic, payload, packet) => {
    try {
      const text = new TextDecoder().decode(payload);
      const msg = JSON.parse(text);

      console.log(
        'MQTT RX:',
        topic,
        msg,
        packet.retain ? 'retained' : 'live'
      );

      if (msg.type === 'cluster-status') {
        lastSdlStatus = msg;
        lastSdlTimestamp = Date.parse(msg.ts);
        renderModulesTable(msg);
        // renderClusterSummary(msg);
      } else if (msg.type === 'cluster-workers') {
        lastWorkers = msg;
        renderWorkersTable(msg);
        renderClusterSummary(msg);
      }

    } catch (e) {
      console.warn(
        'MQTT parse error:',
        e,
        payload
      );
    }
  });

  mqttClient.on('error', err => {
    console.error('MQTT error:', err);
  });

  mqttClient.on('close', () => {
    console.warn('MQTT connection closed');
  });

  mqttClient.on('reconnect', () => {
    console.warn('MQTT reconnecting...');
  });
}


function renderModulesTable(msg) {
  // console.log('renderModulesTable()');
  // console.log(JSON.stringify(msg, null, 2));

  let sdl_html = '<h5>Cluster</h5>';
  sdl_html += '<table class="table table-sm table-striped">';
  sdl_html += `<tbody> `;

  sdl_html += `
      <tr>
        <th>SDL Version</th>
        <td class="dash-val" style="font-size:1em">v${msg.msg.sdl.version}</td>
      </tr>
    `;

  sdl_html += `
      <tr>
        <th>Uptime (d:h:m:s)</th>
        <td class="dash-val" style=" font-size:1em">${msg.msg.sdl.uptime}</td>
      </tr>
    `;

  // sdl_html += `
  //     <tr>
  //       <th>Cluster ID</th>
  //       <td class="dash-val" style=" font-size:1em">${msg.msg.cluster.id}</td>
  //     </tr>
  //   `;

  // sdl_html += `
  //     <tr>
  //       <th>Name</th>
  //       <td class="dash-val" style=" font-size:1em">${msg.msg.cluster.name}</td>
  //     </tr>
  //   `;

  // sdl_html += `
  //     <tr>
  //       <th>Description</th>
  //       <td class="dash-val" style=" font-size:0.8em">${msg.msg.cluster.desc}</td>
  //     </tr>
  //   `;

  // Workers stats
  // const workers = msg.msg.workers || { allocated: 0, available: 0, used: 0 };
  // sdl_html += `
  //     <tr>
  //       <th>SDL Workers</th>
  //       <td class="dash-val" style="font-size:1em">
  //         <span class="dash-val">${workers.available}</span>
  //       </td>
  //     </tr>
  //   `;


  // CPU resources
  // const cpus = msg.msg.resources?.cpus || { allocated: 0, available: 0, used: 0 };
  // sdl_html += `
  //     <tr>
  //       <th><span class="fa fa-microchip" title="CPU Cores" style="font-size:1.2em"></span> CPU Cores</th>
  //       <td class="dash-val" style="font-size:1em">
  //         <span class="dash-val">${cpus.available}</span>
  //       </td>
  //     </tr>
  //   `;

  
  // Memory resources
  // const memory = msg.msg.resources?.memory || { allocated: 0, available: 0, used: 0 };
  // const memAllocGB = Math.round(memory.allocated / (1024 * 1024 * 1024));
  // const memAvailGB = Math.round(memory.available / (1024 * 1024 * 1024));
  // const memUsedGB = memory.used > 0 ? Math.round(memory.used / 1024) : 0;
  
  // sdl_html += `
  //   <tr>
  //     <th><span class="fa fa-memory" title="RAM" style="font-size:1.2em"></span> RAM</th>
  //     <td class="dash-val" style="font-size:1em">
  //       <span class="dash-val">${memAvailGB}</span> GB
  //     </td>
  //   </tr>
  // `;

  
  // GPU resources
  // const gpus = msg.msg.resources?.gpus || { allocated: 0, available: 0, used: 0 };
  // sdl_html += `
  //     <tr>
  //       <th><span class="fa fa-dice-d20" title="GPU" style="font-size:1.2em"></span> GPU (VRAM)</th>
  //       <td class="dash-val" style="font-size:1em">
  //         <span class="dash-val">${gpus.available}</span>
  //       </td>
  //     </tr>
  //   `;
 
  
  sdl_html += `
      </tbody>
    </table>
  `;

  sessionStorage.setItem('dash-sdl-uptime', msg.msg.sdl.uptime);


  const modules = msg.msg.modules;
  let html = '<h5>Service Modules</h5>';
  html += '<table class="table table-sm table-striped">';
  html += `<tbody> `;

  for (const [name, info] of Object.entries(modules)) {
    const ok = info.enabled === true;
    const icon = ok
      ? '<i class="fa-solid fa-circle-check dash-val"></i>'
      : '<i class="fa-solid fa-circle-xmark text-danger"></i>';

    html += `
      <tr>
        <th>${name}</th>
        <td>${icon}</td>
      </tr>
    `;
  }

  html += `
      </tbody>
    </table>
  `;

  // document.getElementById('dash-modules-list').innerHTML = html;
}


function startStatusAgeMonitor() {
  if (!sdlConfig?.update_interval.cluster_status) return;

  const maxAgeMs =
    sdlConfig.update_interval.cluster_status + STALE_GRACE_MS;

  if (statusCheckTimer) {
    clearInterval(statusCheckTimer);
  }

  statusCheckTimer = setInterval(() => {
    if (!lastSdlTimestamp) return;

    const ageMs = Date.now() - lastSdlTimestamp;

    // const ageEl = document.getElementById('dash-modules-age');


    // if (ageMs > maxAgeMs) {
    //   ageEl.innerHTML =
    //     `<span class="text-danger">
    //        <i class="fa-solid fa-triangle-exclamation"></i>
    //        SDL status stale (${Math.round(ageMs / 1000)}s)
    //      </span>`;

    //   markAllModulesDown();
    // } else {
    //   ageEl.innerHTML =
    //     `<span class="dash-val">
    //        <i class="fa-solid fa-circle-check"></i>
    //        SDL online (${Math.round(ageMs / 1000)}s ago)
    //      </span>`;
    // }

    // Save dash-sdl-status to Session Storage
    if (ageMs > maxAgeMs) {
      sessionStorage.setItem('dash-sdl-status', '<span class="text-danger"><i class="fa-solid fa-triangle-exclamation"></i> ' + Math.round(ageMs / 1000) + 's ago' + '</span>');
    } else {
      sessionStorage.setItem('dash-sdl-status', '<i class="fa-solid fa-circle-check"></i> ' + Math.round(ageMs / 1000) + 's ago');
    }

    // sessionStorage.setItem('dash-sdl-status', Math.round(ageMs / 1000) + 's ago');
  }, 1000);
}


function markAllModulesDown() {
  if (!lastSdlStatus?.modules) return;

  const downModules = {};
  downModules.msg = {}

  for (const name of Object.keys(lastSdlStatus.modules)) {
    downModules.msg[name] = { enabled: false };
  }

  renderModulesTable(downModules);
}


function renderWorkersTable(msg) {
  const workers = msg.msg?.workers || {};
  const workerCount = Object.keys(workers).length;

  let html = `<h5>Workers (${workerCount})</h5>`;
  
  if (workerCount === 0) {
    html += '<p class="text-muted">No workers connected</p>';
    document.getElementById('dash-sdl-wkrs').innerHTML = html;
    return;
  }

  html += '<table class="table table-sm table-striped table-hover">';
  html += '<thead>';
  html += '<tr>';
  html += '<th>System</th>';
  html += '<th>Status</th>';
  html += '<th><i class="fa fa-microchip"></i> CPU</th>';
  html += '<th><i class="fa fa-memory"></i> RAM</th>';
  html += '<th><i class="fa fa-dice-d20"></i> GPU</th>';
  html += '</tr>';
  html += '</thead>';
  html += '<tbody>';

  const nowSec = Math.floor(Date.now() / 1000);
  const staleThresholdSec = 60;

  for (const [sdl_id, worker] of Object.entries(workers)) {
    const ageSec = nowSec - worker.ts_utime;  // ✅ Use ts_utime from telemetry
    const isActive = ageSec <= staleThresholdSec;
    
    // Status badge
    const statusBadge = isActive
      ? '<span class="badge bg-success">Active</span>'
      : '<span class="badge bg-danger">Inactive</span>';

    // ✅ Hardware info from nested msg.system.hardware
    const hwType = worker.msg?.system?.hardware?.type || 'unknown';
    // const hwIcon = hwType === 'hw' ? '🖥️' : hwType === 'vm' ? '💠' : '❓';
    const hwIcon = hwType === 'hw' ? '<i class="fa fa-desktop"></i>' : 
               hwType === 'vm' ? '<i class="fa fa-cube"></i>' : 
               '<i class="fa fa-question"></i>';
    const hwManuf = worker.msg?.system?.hardware?.manufacturer || 'Unknown';
    const hwModel = worker.msg?.system?.hardware?.model || 'Unknown';
    const hwCPU = worker.msg?.system?.hardware?.cpu || 'Unknown';
    
    const hardwareDisplay = hwType === 'vm' 
      ? `${hwIcon} ${hwModel}` 
      : `${hwIcon} ${hwManuf} ${hwModel}`;

    // ✅ OS info from nested msg.system
    const osDistro = worker.msg?.system?.distro.replace(/\(\S+\)/, '') || 'Unknown';
    const osArch = worker.msg?.system?.arch || 'unknown';
    const osPlatform = worker.msg?.system?.platform || 'unknown';
    const platformIcon = osPlatform === 'linux' ? '<i class="fab fa-linux"></i>' : 
                     osPlatform === 'win32' ? '<i class="fab fa-windows"></i>' : 
                     osPlatform === 'darwin' ? '<i class="fab fa-apple"></i>' : 
                     '<i class="fa fa-question"></i>';

    const osDisplay = `${platformIcon} ${osDistro} (${osArch})`;

    // ✅ CPU from nested msg.resources and msg.usage
    const cpuAvail = worker.msg?.resources?.cpus?.available || 0;
    const cpuTotal = worker.msg?.resources?.cpus?.allocated || 0;
    const cpuUsed = worker.msg?.usage?.cpu?.total || 0;

    // ✅ Memory from nested msg
    const memAvail = worker.msg?.resources?.memory?.available || 0;
    const memTotal = worker.msg?.resources?.memory?.allocated || 0;
    
    const memAvailGB = Math.round(memAvail / (1024 * 1024 * 1024));
    const memTotalGB = Math.round(memTotal / (1024 * 1024 * 1024));
    const memPercent = worker.msg?.usage?.memory?.percent_used || 0;

    // ✅ GPU from nested msg
    const gpuAvail = worker.msg?.resources?.gpus?.available || 0;
    const gpuTotal = worker.msg?.resources?.gpus?.allocated || 0;
    const gpuData = worker.msg?.usage?.gpu;
    const gpuUsed = gpuData?.total_utilization || 0;
    const gpuMemMB = gpuData?.total_memory_total_mb || 0;
    const gpuMemGB = Math.round(gpuMemMB / 1024);

    // ✅ Uptime from nested msg.uptime
    const procUptime = worker.msg?.uptime?.proc_dhms || 'N/A';
    const sysUptime = worker.msg?.uptime?.sys_dhms || 'N/A';
    
    // Last seen age
    const days = Math.floor(ageSec / 86400);
    const hours = Math.floor((ageSec % 86400) / 3600);
    const minutes = Math.floor((ageSec % 3600) / 60);
    const seconds = Math.floor(ageSec % 60);
    
    let lastSeenAge = '';
    if (days > 0) lastSeenAge += `${days}d `;
    if (hours > 0 || days > 0) lastSeenAge += `${hours}h `;
    if (minutes > 0 || hours > 0 || days > 0) lastSeenAge += `${minutes}m `;
    lastSeenAge += `${seconds}s ago`;

    html += '<tr>';
    
    // System column
    html += `<td>
      <strong>${worker.host}</strong><br>
      <small class="text-muted" style="font-size:0.7em">${worker.sdl_id.substring(0, 8)}...</small><br>
      <small class="text-muted" style="font-size:0.8em">${hardwareDisplay}</small><br>
      <small class="text-muted" style="font-size:0.75em"><i title="CPU" class="fa fa-microchip"></i> <i class="fa fa-memory"></i> <span class="dash-val" style="font-weight:bold">${memTotalGB}</span> GB | <span class="dash-val" style="font-weight:bold"> ${cpuTotal}</span>x ${hwCPU}} </small><br>
      <small class="text-muted" style="font-size:0.75em">${osDisplay}</small>
    </td>`;
    
    // Status column
    html += `<td>
      ${statusBadge}<br>
      <small class="text-muted">SDL: ${procUptime}</small><br>
      <small class="text-muted">OS: ${sysUptime}</small><br>
      <small class="text-muted">${lastSeenAge}</small>
    </td>`;
    
    // CPU
    html += `<td>
      <span class="dash-val">${cpuAvail}</span> / ${cpuTotal}
      ${cpuUsed > 0 ? `<br><small class="text-muted">${cpuUsed}% load</small>` : ''}
    </td>`;
    
    // Memory
    html += `<td>
      <span class="dash-val">${memAvailGB}</span> / ${memTotalGB} GB
      ${memPercent > 0 ? `<br><small class="text-muted">${memPercent}% used</small>` : ''}
    </td>`;
    
    // GPU
    html += `<td>
      <span class="dash-val">${gpuAvail}</span> / ${gpuTotal}
      ${gpuMemGB > 0 ? `<br><small class="text-muted">(${gpuMemGB} GB)</small>` : ''}
      ${gpuUsed > 0 ? `<br><small class="text-muted">${gpuUsed}% load</small>` : ''}
    </td>`;
    
    html += '</tr>';
  }

  html += '</tbody>';
  html += '</table>';

  document.getElementById('dash-sdl-wkrs').innerHTML = html;
}


function renderClusterSummary(msg) {
  const workers = msg.msg?.workers || {};
  const workerCount = Object.keys(workers).length;
  
  // Aggregate resources from all workers
  let totalCpus = 0;
  let totalMemory = 0;
  let totalGpus = 0;
  let activeCpus = 0;
  let activeMemory = 0;
  let activeGpus = 0;
  let activeWorkers = 0;
  
  const nowSec = Math.floor(Date.now() / 1000);
  const staleThresholdSec = 60;

  for (const worker of Object.values(workers)) {
    const ageSec = nowSec - worker.ts_utime;
    const isActive = ageSec <= staleThresholdSec;
    
    // Totals (all workers)
    totalCpus += worker.msg?.resources?.cpus?.allocated || 0;
    totalMemory += worker.msg?.resources?.memory?.allocated || 0;
    totalGpus += worker.msg?.resources?.gpus?.allocated || 0;
    
    // Active workers only
    if (isActive) {
      activeWorkers++;
      activeCpus += worker.msg?.resources?.cpus?.available || 0;
      activeMemory += worker.msg?.resources?.memory?.allocated || 0;
      activeGpus += worker.msg?.resources?.gpus?.available || 0;
    }
  }
  
  // Convert memory to GB
  const totalMemoryGB = Math.round(totalMemory / (1024 * 1024 * 1024));
  const activeMemoryGB = Math.round(activeMemory / (1024 * 1024 * 1024));

  // Get cluster info from last status message
  const clusterName = lastSdlStatus?.msg?.cluster?.name || 'Unknown';
  const clusterDesc = lastSdlStatus?.msg?.cluster?.desc || '';

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <h5>Cluster: <span class="dash-val">${clusterName}</span></h5>
      <small class="dash-val">${clusterDesc}</small>
    </div>
  `;

  html += '<div class="row">';
  
    // SDL card
  html += `
    <div class="col-md-3">
      <div class="card border mb-3">
        <div class="card-body">
          <h6 class="card-title">
            <i class="fa-solid fa-square-binary"></i> SDL
          </h6>
          <span class="card-text">Version: <span class="dash-val">v${config?.sdl?.version}</span></span><br>
          <span class="card-text">Uptime: <span class="dash-val" id="dash-sdl-uptime"></span></span><br>
          <span class="card-text">Status: <span class="dash-val" id="dash-sdl-status"></span></span>
        </div>
      </div>
    </div>
  `;

  // Workers card 
  html += `
    <div class="col-md-2">
      <div class="card border mb-3">
        <div class="card-body">
          <h6 class="card-title">
            <i class="fa fa-server"></i> Workers
          </h6>
          <h3 class="card-text dash-val">${activeWorkers}</h3>
          <small class="text-muted">of ${workerCount} total</small>
        </div>
      </div>
    </div>
  `;
  
  // CPU card 
  html += `
    <div class="col-md-2">
      <div class="card border mb-3">
        <div class="card-body">
          <h6 class="card-title">
            <i class="fa fa-microchip"></i> CPU Cores
          </h6>
          <h3 class="card-text dash-val">${activeCpus}</h3>
          <small class="text-muted">of ${totalCpus} total</small>
        </div>
      </div>
    </div>
  `;
  
  // Memory card 
  html += `
    <div class="col-md-2">
      <div class="card border mb-3">
        <div class="card-body">
          <h6 class="card-title">
            <i class="fa fa-memory"></i> RAM
          </h6>
          <h3 class="card-text dash-val">${activeMemoryGB} GB</h3>
          <small class="text-muted">of ${totalMemoryGB} GB total</small>
        </div>
      </div>
    </div>
  `;
  
  // GPU card 
  html += `
    <div class="col-md-2">
      <div class="card border mb-3">
        <div class="card-body">
          <h6 class="card-title">
            <i class="fa fa-dice-d20"></i> GPUs
          </h6>
          <h3 class="card-text dash-val">${activeGpus}</h3>
          <small class="text-muted">of ${totalGpus} total</small>
        </div>
      </div>
    </div>
  `;
  
  html += '</div>'; // end row

  document.getElementById('dash-sdl-clstr').innerHTML = html;

  // Read dash-sdl-uptime from Session Storage
  const dashSdlUptime = sessionStorage.getItem('dash-sdl-uptime');
  if (dashSdlUptime) {
    document.getElementById('dash-sdl-uptime').innerHTML = dashSdlUptime;
  }

  // Read dash-sdl-status from Session Storage
  const dashSdlStatus = sessionStorage.getItem('dash-sdl-status');
  if (dashSdlStatus) {
    document.getElementById('dash-sdl-status').innerHTML = dashSdlStatus;
  }
}