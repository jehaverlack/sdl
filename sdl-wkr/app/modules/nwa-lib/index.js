// Node Web App (NWA) Library Module
import fs from 'fs';
import path from 'path';
import os from 'os';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { get } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// console.log("DEBUG: __dirname: " + __dirname);

// Process start time (set once per Node.js process)
const PROCESS_START_TS = Date.now();

const config = load_config();

function load_config() {
    let config = {};

    const argv = yargs(hideBin(process.argv))
    .usage('Usage: npm start -- <options>')
    .option('configfile', {
        alias: 'c',
        description: 'Path to config file',
        type: 'string'
    })
    .help()
    .alias('help', 'h')
    .argv;

    // console.log("DEBUG: dirname: " + __dirname);
    let sdl_home = path.join(__dirname, '..', '..', '..', '..', '..'); // SDL_HOME Default 
    let sdl_wkr_cfg_file = path.join(sdl_home, 'conf', 'sdl-wkr-config.json');

    // console.log("DEBUG: SDL_HOME: " + sdl_home);
    // console.log("DEBUG: SDL_WKR_CFG_FILE: " + sdl_wkr_cfg_file);
    try {
        fs.accessSync(sdl_wkr_cfg_file, fs.constants.R_OK);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }

    // // Load from ENV
    // if (process.env.SDL_HOME) {
    //     sdl_home = process.env.SDL_HOME;
    //     sdl_wkr_cfg_file = path.join(sdl_home, 'conf', 'sdl-wkr-config.json');
    //     // console.log("DEBUG3: SDL_HOME: " + sdl_home);
    //     // console.log("DEBUG3: SDL_WKR_CFG_FILE: " + sdl_wkr_cfg_file);
    //     try {
    //         fs.accessSync(sdl_wkr_cfg_file, fs.constants.R_OK);
    //     } catch (err) {
    //         console.error(err);
    //         process.exit(1);
    //     }
    // }

    // // Load from ARGV
    // if (argv.configfile) {
    //     sdl_home = path.dirname(argv.configfile);
    //     sdl_wkr_cfg_file = path.join(sdl_home, 'conf', 'sdl-wkr-config.json');
    //     // console.log("DEBUG4: SDL_HOME: " + sdl_home);
    //     // console.log("DEBUG4: SDL_WKR_CFG_FILE: " + sdl_wkr_cfg_file);
    //     try {
    //         fs.accessSync(sdl_wkr_cfg_file, fs.constants.R_OK);
    //     } catch (err) {
    //         console.error(err);
    //         process.exit(1);
    //     }
    // }
    
    // console.log("DEBUG: SDL_HOME: " + sdl_home);
    // console.log("DEBUG: SDL_WKR_CFG_FILE: " + sdl_wkr_cfg_file);    



    // Load Config
    try {
        config = JSON.parse(fs.readFileSync(sdl_wkr_cfg_file, 'utf8'));
        config.dirs.base = config.dirs.base + '/..'
    } catch (err) {
        console.error(err);
    }

    // console.log("DEBUG: sdl_home: " + sdl_home);

    // Expand Data Directory
    let search_replace = {}
    search_replace['DIRNAME'] = __dirname
    // search_replace['SDLHOME'] = sdl_home
    config.dirs['SDLHOME'] = sdl_home
    for (let d in config.dirs) {
        search_replace[d.toUpperCase()] = d
    }

    for (let d in config.dirs) {
        for (let s in search_replace) {
            switch (s) {
                case 'DIRNAME':
                    config.dirs[d] = path.join(config.dirs[d].replace(s, __dirname))
                    break
                default:
                    config.dirs[d] = path.join(config.dirs[d].replace(s, config.dirs[search_replace[s]]))
                    break
            }
        }
    }

    // Replace DIRNAMES for metadata objects
    for (let m in config.metadata) {
        for (let s in search_replace) {
            switch (s) {
                case 'DIRNAME':
                config.metadata[m] = path.join(config.metadata[m].replace(s, __dirname))
                break
                default:
                config.metadata[m] = path.join(config.metadata[m].replace(s, config.dirs[search_replace[s]]))
                break
            }
        }
    }

    // Ensure all directories exist
    for (let d in config.dirs) {
        if (!fs.existsSync(config.dirs[d])) {
            fs.mkdirSync(config.dirs[d], { recursive: true });
        }
    }  
        // for (let k in config.dependencies[d]) {
        //     // if k matches case insensitive "dependencies" the remove elemend k.
        //     if (k.match(/[Dd]ependencies/)) {
        //         delete config.dependencies[d][k]
        //     }

        //     if (k.match(/scripts/)) {
        //         delete config.dependencies[d][k]
        //     }
        // }

    // Load Package Info
    config.package = JSON.parse(fs.readFileSync(path.join(config.dirs.app, 'package.json'), 'utf8'));
    config.dependencies = {}

    for (let d in config.package.dependencies) {
        config.dependencies[d] = JSON.parse(fs.readFileSync(path.join(config.dirs.app, 'node_modules', d, 'package.json'), 'utf8'));
    }

    // -------------------------------
    // Host Metadata (static)
    // -------------------------------
    config.host = {
    hostname: os.hostname(),
    ips: [],

    os: {
        platform: null,
        id: null,
        name: null,
        version: null,
        pretty_name: null
,    },

    cpu: {
        arch: os.arch(),              // x64, arm64, etc.
        model: null,
        cores_logical: 0
    },

    memory: {
        total_gb: Math.round(os.totalmem() / (1024 ** 3))
    },

    gpu: {
    },

    network: {}

    };

    config.sdl = {
      version: config.package.version
    }

    config.identity = {
        sdl_id: null,
        created_at: null,
        hostname: null
    }

    // console.log('config: host:', JSON.stringify(config.host, null, 2));

    config.host.gpu = detectGPUs();

    // Get Host IP Addresses
    const networkInterfaces = os.networkInterfaces();
    // console.log(JSON.stringify(networkInterfaces, null, 2));
    config.host.ips = [];
    for (const interfaceName in networkInterfaces) {
        config.host.network[interfaceName] = networkInterfaces[interfaceName];

        const addresses = networkInterfaces[interfaceName];
        for (const address of addresses) {
            if (address.family === 'IPv4' && !address.internal) {
                config.host.ips.push(address.address);
            }
        }
    }

    config.host.ips.push('127.0.0.1');

    // -------------------------------
    // CPU Info
    // -------------------------------
    const cpus = os.cpus();
    // console.log('cpus: ', JSON.stringify(cpus, null, 2));
    if (cpus.length > 0) {
        config.host.cpu.model = cpus[0].model;
        config.host.cpu.cores_logical = cpus.length;
    }

    config.host.os.platform = os.platform();

    // -------------------------------
    // OS Info from /etc/os-release (Linux)
    // -------------------------------
    const osReleasePath = '/etc/os-release';

    if (fs.existsSync(osReleasePath)) {
        try {
            const content = fs.readFileSync(osReleasePath, 'utf8');
            const lines = content.split('\n');

            for (const line of lines) {
            const match = line.match(/^([A-Z_]+)=(.*)$/);
            if (!match) continue;

            const key = match[1];
            const value = match[2].replace(/^"/, '').replace(/"$/, '');

            switch (key) {
                case 'ID':
                config.host.os.id = value;
                break;
                case 'NAME':
                config.host.os.name = value;
                break;
                case 'VERSION_ID':
                config.host.os.version = value;
                break;
                case 'PRETTY_NAME':
                config.host.os.pretty_name = value;
                break;
            }
            }
        } catch (err) {
            // Non-fatal: OS info optional
        }
    }

    // -------------------------------
    // SDL Identity
    // -------------------------------

    try {
        const idinfo = load_or_create_sdl_id(config.dirs.sdlhome);
        config.identity.sdl_id = idinfo.sdl_id;
        config.identity.created_at = idinfo.created_at;
        config.identity.hostname = config.host.hostname;
    } catch (err) {
        console.error('Idnetity Error:', err);
        process.exit(1);
    }

    // Node.js Version
    // config.nodejs = {
    //     version: process.version,
    // }
    config.nodejs = {
        version: process.version,          // v22.16.0
        v8: process.versions.v8,           // V8 engine version
        abi: process.versions.modules,     // Node ABI
        arch: process.arch,                // x64, arm64
        platform: process.platform,        // linux, darwin, win32
        exec_path: process.execPath,       // /usr/bin/node
        openssl: process.versions.openssl || null,
        uv: process.versions.uv || null,
        icu: process.versions.icu || null
    };

    // console.log('config: ', JSON.stringify(config.dirs, null, 2));
    // console.log('modconf: ', config.dirs.modconf);


    // Load Module Config
    for (let m in config.modules) {
        try {
            config.modules[m] = JSON.parse(fs.readFileSync(path.join(config.dirs.modconf, `${m}.json`), 'utf8'));
            config.modules[m].dir = path.join(config.dirs.modules, m);
            config.modules[m].package = JSON.parse(fs.readFileSync(path.join(config.modules[m].dir, 'package.json'), 'utf8'));
            config.modules[m].main = path.join(config.modules[m].dir, config.modules[m].package.main);
            
        } catch (err) {
            console.error(err);
        }

        // for each item, expand dirs with search and replace
        for (let i in config.modules[m]) {
            // console.log("DEBUG: " + i + " " + String(config.modules[m][i]))
            // If item is a path
            if (String(config.modules[m][i]).match(/\//)) {
                // console.log("DEBUG: PATH: "  + i + " " + String(config.modules[m][i]))
                for (let s in search_replace) {
                    switch (s) {
                        case 'DIRNAME':
                            // config.modules[m][i] = String(path.join(config.modules[m][i])).replace(s, __dirname)
                            config.modules[m][i] = path.join(config.modules[m][i]).replace(s, __dirname)
                            break
                        default:
                            // config.modules[m][i] = String(path.join(config.modules[m][i])).replace(s, config.dirs[search_replace[s]])
                            config.modules[m][i] = path.join(config.modules[m][i]).replace(s, config.dirs[search_replace[s]])
                            break
                    }
                }                    
            } else {
                // console.log("DEBUG: NOT PATH: " + i + " " + String(config.modules[m][i]))
            }
        }
    }

    return config;
}


// Logger Function
function log(msg, cnsl=false) {
    const now = new Date();
    const ts_datetime = now.toISOString();                         // "YYYY-MM-DDTHH:MM:SS.sssZ"
    const ts_date = ts_datetime.split('T')[0];                     // "YYYY-MM-DD"
  
    const logFile = path.join(config.dirs.logs, `${config.package.name}-${ts_date}.log`);
  
    try {
      fs.appendFileSync(logFile, `${ts_datetime} : ${msg}\n`, 'utf8');
      if (cnsl) { console.log(msg); }
    } catch (err) {
      console.error(`Logger error: Could not write to ${logFile}`, err);
    }
  }

  function ipToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function intToIp(int) {
  return [
    (int >>> 24) & 255,
    (int >>> 16) & 255,
    (int >>> 8) & 255,
    int & 255
  ].join('.');
}

function computeBroadcast(address, netmask) {
  try {
    const ipInt = ipToInt(address);
    const maskInt = ipToInt(netmask);
    const networkInt = ipInt & maskInt;
    const broadcastInt = networkInt | (~maskInt >>> 0);
    return intToIp(broadcastInt);
  } catch {
    return null;
  }
}

function load_or_create_sdl_id(sdl_home) {
    const id_dir = path.join(sdl_home, 'conf');
    const id_file = path.join(id_dir, 'sdl-id.json');

    try {
        if (fs.existsSync(id_file)) {
            const data = JSON.parse(fs.readFileSync(id_file, 'utf8'));
            if (data.sdl_id) {
                return data;
            }
        }
    } catch (err) {
        console.error('Failed to read sdl-id.json:', err);
        process.exit(1);
    }

    // Create new identity
    const sdl_id = {
        sdl_id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        hostname: os.hostname()
    };

    try {
        fs.mkdirSync(id_dir, { recursive: true });
        fs.writeFileSync(id_file, JSON.stringify(sdl_id, null, 2), { mode: 0o600 });
    } catch (err) {
        console.error('Failed to write sdl-id.json:', err);
        process.exit(1);
    }

    return sdl_id;
}



/**
 * Detect GPUs using /sys/class/drm (authoritative) + lspci (labels)
 * Non-root, Linux-only.
 */
export function detectGPUs() {
  const drmPath = '/sys/class/drm';
  const gpus = [];

  if (!fs.existsSync(drmPath)) {
    return [];
  }

  // --- Helper functions ---
  const read = p => {
    try { return fs.readFileSync(p, 'utf8').trim(); }
    catch { return null; }
  };

  const readlink = p => {
    try { return fs.realpathSync(p); }
    catch { return null; }
  };

  const exec = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
    } catch {
      return null;
    }
  };

  const vendorMap = {
    '0x10de': 'nvidia',
    '0x8086': 'intel',
    '0x1002': 'amd'
  };

  // --- Collect render nodes indexed by PCI bus ---
  const renderNodes = {};
  for (const entry of fs.readdirSync(drmPath)) {
    if (!entry.startsWith('renderD')) continue;

    const devPath = readlink(path.join(drmPath, entry, 'device'));
    if (!devPath) continue;

    const pciBusId = path.basename(devPath);
    renderNodes[pciBusId] = entry;
  }

  // --- Enumerate card devices ---
  for (const entry of fs.readdirSync(drmPath)) {
    if (!/^card[0-9]+$/.test(entry)) continue;

    const cardPath = path.join(drmPath, entry);
    const devicePath = readlink(path.join(cardPath, 'device'));
    if (!devicePath) continue;

    const pciBusId = path.basename(devicePath);

    const vendorHex = read(path.join(cardPath, 'device', 'vendor'));
    const vendor = vendorMap[vendorHex] || 'unknown';

    const driver = (() => {
      const d = readlink(path.join(cardPath, 'device', 'driver'));
      return d ? path.basename(d) : null;
    })();

    // Human-readable model (best-effort)
    const lspciOut = exec('lspci', ['-s', pciBusId]);
    // const model = lspciOut
    //   ? lspciOut.replace(/^.*?:\s*/, '')
    //   : null;
    const model = (() => {
        if (!lspciOut) return null;

        // Remove leading PCI address (e.g. "04:00.0 ")
        let s = lspciOut.replace(/^[0-9a-fA-F:.]+\s+/, '');

        // Remove device class prefix
        s = s.replace(/^(VGA compatible controller|3D controller):\s*/i, '');

        // Remove revision suffix
        s = s.replace(/\s*\(rev.*\)$/i, '');

        return s.trim();
    })();

    const renderNode = renderNodes[pciBusId] || null;
    const computeCapable = Boolean(renderNode);

    const gpu = {
      id: entry,
      pci_bus_id: pciBusId,
      vendor,
      driver,
      model,
      compute_capable: computeCapable,
      render_node: renderNode,
      memory: {
        type: vendor === 'nvidia' ? 'dedicated' : 'shared',
        total_mb: null
      }
    };

    // --- NVIDIA enrichment (non-root, correct fields) ---
    if (vendor === 'nvidia') {
        const nvidiaSmi = findNvidiaSmi();

        if (nvidiaSmi) {
            const smi = exec(nvidiaSmi, [
            '--query-gpu=pci.bus_id,memory.total',
            '--format=csv,noheader,nounits'
            ]);

            if (smi) {
            const target = pciShortId(pciBusId);

            for (const line of smi.split('\n')) {
                const cols = line.split(',').map(s => s.trim());
                if (cols.length < 2) continue;

                const [bus, memMb] = cols;

                if (pciShortId(bus) === target) {
                gpu.memory.total_mb = Number(memMb);
                break;
                }
            }
            }
        }
    }

    gpus.push(gpu);
  }

  return gpus;
}

// Normalize PCI bus IDs so "0000:04:00.0" === "00000000:04:00.0"
function normalizePciBusId(id) {
  return id
    .toLowerCase()
    .replace(/^0+/, '')      // strip leading domain zeros
    .replace(/^:/, '');      // safety
}

function findNvidiaSmi() {
  const candidates = [
    '/usr/bin/nvidia-smi',
    '/bin/nvidia-smi',
    '/usr/local/bin/nvidia-smi'
  ];

  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }

  return null;
}

function pciShortId(id) {
  if (!id) return null;

  // Extract the stable "bus:device.function" portion
  const m = id.match(/([0-9a-fA-F]{2}:[0-9a-fA-F]{2}\.[0-9])/);
  return m ? m[1].toLowerCase() : null;
}

function getProcessStartTs() {
  return PROCESS_START_TS;
}

function getUptimeMs() {
  return Date.now() - PROCESS_START_TS;
}

function getUptimeSec() {
  return Math.floor((Date.now() - PROCESS_START_TS) / 1000);
}

function getUptimeDHMS() {
  const uptimeSec = getUptimeSec();
  const d = Math.floor(uptimeSec / 86400);
  const h = Math.floor((uptimeSec % 86400) / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = Math.floor(uptimeSec % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

function getOSUptimeDHMS() {
  const uptimeSec = os.uptime();
  const d = Math.floor(uptimeSec / 86400);
  const h = Math.floor((uptimeSec % 86400) / 3600);
  const m = Math.floor((uptimeSec % 3600) / 60);
  const s = Math.floor(uptimeSec % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

export { load_config, log, ipToInt, intToIp, computeBroadcast, getProcessStartTs, getUptimeMs, getUptimeSec, getUptimeDHMS, getOSUptimeDHMS };
