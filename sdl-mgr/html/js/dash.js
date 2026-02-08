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
    "hostname": '<span class="dash-val">' + config.host.hostname + '</span>',
    "sdl_id": '<span class="dash-val" style=" font-size:0.8em">' + config.identity.sdl_id + '</span>',
    "cpu cores": '<span class="dash-val">' + config.host.cpu.cores_logical + '</span> <span style="font-size:0.7em">' + config.host.cpu.model + '</span>',
    // "cores": config.host.cpu.cores_logical,
    "ram": '<span class="dash-val">' + config.host.memory.total_gb + '</span> GB ',
    "gpu": gpuSummary,
    "net": "",
    "os": config.host.os.pretty_name
}


for (let intf in config.host.network) {
    // console.log(intf, JSON.stringify(config.host.network[intf], null, 2));
    if (intf != 'lo') {
      for (let addr in config.host.network[intf]) {
        if (config.host.network[intf][addr].family == 'IPv4') {
          hostinfo["net"] += '<span class="dash-val" style=" font-size: 0.9em">' + config.host.network[intf][addr].cidr + '</span><br> ';
        }
      }
    }    
} 


let host_html = '<h5>Manager</h5>\n';
host_html += '<table class="table table-sm table-striped">\n';
// host_html += '<thead>\n';
// host_html += '<tr>\n';
// host_html += '<th>Key</th>\n';
// host_html += '<th>Value</th>\n';
// host_html += '</tr>\n';
// host_html += '</thead>\n';
host_html += '<tbody>\n';

for (let key in hostinfo) {
    host_html += '<tr>\n';
    host_html += '<td><b>' + key + '</b></td>\n';
    host_html += '<td>' + hostinfo[key] + '</td>\n';
    host_html += '</tr>\n';
}

host_html += '</tbody>\n';
host_html += '</table>\n';

document.getElementById('dash-sdl-mgr-info').innerHTML = host_html;

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
      } else if (msg.type === 'cluster-workers') {
        lastWorkers = msg;
        renderWorkersTable(msg);
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

  sdl_html += `
      <tr>
        <th>Name</th>
        <td class="dash-val" style=" font-size:1em">${msg.msg.cluster.name}</td>
      </tr>
    `;

  sdl_html += `
      <tr>
        <th>Description</th>
        <td class="dash-val" style=" font-size:0.8em">${msg.msg.cluster.desc}</td>
      </tr>
    `;

  // Workers stats
  const workers = msg.msg.workers || { allocated: 0, available: 0, used: 0 };
  sdl_html += `
      <tr>
        <th>SDL Workers</th>
        <td class="dash-val" style="font-size:1em">
          <span class="dash-val">${workers.available}</span>
        </td>
      </tr>
    `;
  // sdl_html += `
  //     <tr>
  //       <th>SDL Workers (active/total)</th>
  //       <td class="dash-val" style="font-size:1em">
  //         <span class="dash-val">${workers.available}</span> / ${workers.allocated}
  //       </td>
  //     </tr>
  //   `;

  // CPU resources
  const cpus = msg.msg.resources?.cpus || { allocated: 0, available: 0, used: 0 };
  sdl_html += `
      <tr>
        <th><span class="fa fa-microchip" title="CPU Cores" style="font-size:1.2em"></span> CPU Cores</th>
        <td class="dash-val" style="font-size:1em">
          <span class="dash-val">${cpus.available}</span>
        </td>
      </tr>
    `;
  // sdl_html += `
  //     <tr>
  //       <th><span class="fa fa-microchip" title="CPU Cores" style="font-size:1.2em"></span> CPU Cores</th>
  //       <td class="dash-val" style="font-size:1em">
  //         <span class="dash-val">${cpus.available}</span> / ${cpus.allocated}
  //         ${cpus.used > 0 ? `<span style="font-size:0.8em">(${cpus.used} in use)</span>` : ''}
  //       </td>
  //     </tr>
  //   `;

  // Memory resources
  const memory = msg.msg.resources?.memory || { allocated: 0, available: 0, used: 0 };
  const memAllocGB = Math.round(memory.allocated / (1024 * 1024 * 1024));
  const memAvailGB = Math.round(memory.available / (1024 * 1024 * 1024));
  const memUsedGB = memory.used > 0 ? Math.round(memory.used / 1024) : 0;
  
  sdl_html += `
    <tr>
      <th><span class="fa fa-memory" title="RAM" style="font-size:1.2em"></span> RAM</th>
      <td class="dash-val" style="font-size:1em">
        <span class="dash-val">${memAvailGB}</span> GB
      </td>
    </tr>
  `;
  // sdl_html += `
  //     <tr>
  //       <th><span class="fa fa-memory" title="RAM" style="font-size:1.2em"></span> RAM (GB)</th>
  //       <td class="dash-val" style="font-size:1em">
  //         <span class="dash-val">${memAvailGB}</span> / ${memAllocGB} GB
  //         ${memUsedGB > 0 ? `<span style="font-size:0.8em">(${memUsedGB} GB in use)</span>` : ''}
  //       </td>
  //     </tr>
  //   `;

  // GPU resources
  const gpus = msg.msg.resources?.gpus || { allocated: 0, available: 0, used: 0 };
  sdl_html += `
      <tr>
        <th><span class="fa fa-dice-d20" title="GPU" style="font-size:1.2em"></span> GPU (VRAM)</th>
        <td class="dash-val" style="font-size:1em">
          <span class="dash-val">${gpus.available}</span>
        </td>
      </tr>
    `;
  // sdl_html += `
  //     <tr>
  //       <th><span class="fa fa-dice-d20" title="GPU" style="font-size:1.2em"></span> GPU</th>
  //       <td class="dash-val" style="font-size:1em">
  //         <span class="dash-val">${gpus.available}</span> / ${gpus.allocated}
  //         ${gpus.used > 0 ? `<span style="font-size:0.8em">(${gpus.used} in use)</span>` : ''}
  //       </td>
  //     </tr>
  //   `;
    
  sdl_html += `
      </tbody>
    </table>
  `;
  document.getElementById('dash-sdl-info').innerHTML = sdl_html;



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

  document.getElementById('dash-modules-list').innerHTML = html;
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

    const ageEl = document.getElementById('dash-modules-age');

    if (ageMs > maxAgeMs) {
      ageEl.innerHTML =
        `<span class="text-danger">
           <i class="fa-solid fa-triangle-exclamation"></i>
           SDL status stale (${Math.round(ageMs / 1000)}s)
         </span>`;

      markAllModulesDown();
    } else {
      ageEl.innerHTML =
        `<span class="dash-val">
           <i class="fa-solid fa-circle-check"></i>
           SDL online (${Math.round(ageMs / 1000)}s ago)
         </span>`;
    }
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
  html += '<th>Hostname</th>';
  html += '<th>Status</th>';
  html += '<th>Hardware</th>';
  html += '<th><i class="fa fa-microchip"></i> CPU</th>';
  html += '<th><i class="fa fa-memory"></i> RAM</th>';
  html += '<th><i class="fa fa-dice-d20"></i> GPU</th>';
  html += '<th>Uptime</th>';
  html += '<th>Last Seen</th>';
  html += '</tr>';
  html += '</thead>';
  html += '<tbody>';

  for (const [sdl_id, worker] of Object.entries(workers)) {
    const status = worker.status === 'active'
      ? '<span class="badge bg-success">Active</span>'
      : '<span class="badge bg-secondary">Inactive</span>';

    // Hardware info
    const hwType = worker.hardware?.type || 'unknown';
    const hwIcon = hwType === 'hw' ? '🖥️' : hwType === 'vm' ? '💠' : '❓';
    const hwManuf = worker.hardware?.manufacturer || 'Unknown';
    const hwModel = worker.hardware?.model || 'Unknown';
    const hardware = `<span title="${hwManuf} - ${hwModel}">${hwIcon} ${hwType === 'vm' ? hwModel : hwManuf}</span>`;

    // CPU
    const cpuAvail = worker.resources?.cpus?.available || 0;
    const cpuTotal = worker.resources?.cpus?.allocated || 0;
    const cpuUsed = worker.usage?.cpu?.total || 0;

    // Memory
    const memAvail = worker.resources?.memory?.available || 0;
    const memTotal = worker.resources?.memory?.allocated || 0;
    const memUsed = worker.usage?.memory?.used || 0;
    
    const memAvailGB = Math.round(memAvail / (1024 * 1024 * 1024));
    const memTotalGB = Math.round(memTotal / (1024 * 1024 * 1024));
    const memUsedGB = Math.round(memUsed / (1024 * 1024 * 1024));
    const memPercent = worker.usage?.memory?.percent_used || 0;

    // GPU
    const gpuAvail = worker.resources?.gpus?.available || 0;
    const gpuTotal = worker.resources?.gpus?.allocated || 0;
    const gpuData = worker.usage?.gpu;
    const gpuUsed = gpuData?.total_utilization || 0;
    const gpuMemMB = gpuData?.total_memory_total_mb || 0;
    const gpuMemGB = Math.round(gpuMemMB / 1024);

    // Uptime
    const uptime = worker.uptime?.proc_dhms || 'N/A';
    
    // Last seen
    const lastSeen = worker.last_seen 
      ? new Date(worker.last_seen).toLocaleString()
      : 'N/A';

    html += '<tr>';
    html += `<td><strong>${worker.hostname}</strong><br><small class="text-muted" style="font-size:0.7em">${worker.sdl_id.substring(0, 8)}...</small></td>`;
    html += `<td>${status}</td>`;
    html += `<td><small>${hardware}</small></td>`;
    html += `<td>
      <span class="dash-val">${cpuAvail}</span> / ${cpuTotal}
      ${cpuUsed > 0 ? `<br><small class="text-muted">${cpuUsed}% load</small>` : ''}
    </td>`;
    html += `<td>
      <span class="dash-val">${memAvailGB}</span> / ${memTotalGB} GB
      ${memPercent > 0 ? `<br><small class="text-muted">${memPercent}% used</small>` : ''}
    </td>`;
    html += `<td>
      <span class="dash-val">${gpuAvail}</span> / ${gpuTotal}
      ${gpuMemGB > 0 ? `<br><small class="text-muted">(${gpuMemGB} GB)</small>` : ''}
      ${gpuUsed > 0 ? `<br><small class="text-muted">${gpuUsed}% load</small>` : ''}
    </td>`;
    html += `<td><small>${uptime}</small></td>`;
    html += `<td><small>${lastSeen}</small></td>`;
    html += '</tr>';
  }

  html += '</tbody>';
  html += '</table>';

  document.getElementById('dash-sdl-wkrs').innerHTML = html;
}