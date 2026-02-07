# Software Defined Laboratory (SDL)

| Attribute | Value |
| --- | --- |
| **Author** | John Haverlack |
| **Copyright** | 2026 John Haverlack |
| **License** | MIT |
| **Version** | 0.3.8 |
| **Date** | 2026-02-07 |

## Overview

The Software Defined Laboratory (SDL) project provides a generalized distributed computing platform for managing parallel computational workflows across a cluster of distributed nodes.  SDL is a minimalistic High Performance Compute (HPC) platform focused on extreme minimizaton of technical debt associated configuration, deployability, and maintenance of the cluster.

# Roadmap

## Prioritized Tasks

MVP - Minimum Viable Product Task List

**Core Infrastructure** ✅ (Complete)
- [x] sdl-mgr MQTT Broker
- [x] sdl-mgr UDP Beacon
- [x] sdl-mgr Web UI MQTT WebSocket Pub/Sub
- [x] sdl-wkr UDP Listener
- [x] SDL_ID Node ID
- [x] Version Updater Script
- [x] Deploy sdl-mgr to $SDL_HOME/sdl-mgr
- [x] Create SDL Worker Dist Build Process
- [x] Create SDL Worker Install to $SDL_HOME
- [x] SDL Install Script
- [x] Create SDL Worker Auto Update Process
- [x] Create Worker Join Process
- [x] Create Worker Telemetry Process

**Worker Monitoring & Telemetry** 🔄 (In Progress)
- [ ] Worker Hardware Inventory Detection
  - [ ] Physical vs Logical CPU cores (hyperthreading)
  - [ ] Physical vs VM detection (hypervisor flag)
  - [ ] GPU VRAM capacity aggregation
  - [ ] Memory capacity (bytes → GB conversion)
- [ ] Worker Real-time Load Status (pure Node.js)
  - [ ] CPU usage percentage (`os.cpus()` times)
  - [ ] RAM usage (total/free/used via `os.totalmem()/freemem()`)
  - [ ] GPU usage (exec-based: nvidia-smi, rocm-smi)
  - [ ] Disk IO (optional: exec-based)
- [ ] Worker Uptime Tracking
  - [ ] SDL process uptime (`process.uptime()`)
  - [ ] OS uptime (`os.uptime()`)
- [ ] Worker Display Improvements
  - [ ] Show OS distro + version in Platform column (e.g., "Debian 12 / x64")
  - [ ] Show system type (Physical 🖥️ / VM 💠)
  - [ ] Show GPU VRAM in GPU column (e.g., "2 GPUs (48 GB)")
  - [ ] Show worker uptime in dashboard
  - [ ] Display last seen as elapsed time in dashboard, not date
  - [ ] Track Username for sdl process
- [ ] Web UI
  - [ ] Progresive Web App
  - [ ] Editable Dashboard
  - [ ] Panel Icon


**Resource Management**
- [ ] CPU Reserve Capacity Allocation
  - [ ] Config option: `reserve_cpus: N` (keep N cores for system)
  - [ ] Track: `total`, `reserved`, `allocated`, `available`, `used`
  - [ ] Display reserved capacity in dashboard
- [ ] Memory Reserve Capacity (optional, future)
- [ ] GPU Reserve Capacity (optional, future)

**Service Management**
- [x] Start/Stop shell scripts (for systems without systemd user services)
  - [x] `start-sdl-mgr.sh` / `stop-sdl-mgr.sh`
  - [x] `start-sdl-wkr.sh` / `stop-sdl-wkr.sh`
- [ ] Combined systemd service
  - [ ] `sdl.service` to manage both sdl-mgr and sdl-wkr together
  - [ ] Support for system-level (sudo) and user-level services
- [ ] SDL-MGR auto-installs SDL-WKR
  - [ ] Manager node becomes worker by default
  - [ ] Config flag to disable: `install_worker_on_manager: false
  - [x] Pass HTTP Port to SDL-WKR Curl installer
  - [ ] Update Install Summary
  - [ ] Add Quite Mode to sdl-wkr install



**Data & Storage**
- [ ] Data Storage Organizational Structure
  - [ ] Define directory hierarchy for tasks, results, logs
  - [ ] Implement file naming conventions
  - [ ] Add cleanup/retention policies
- [ ] MinIO S3 Storage Server Integration
  - [ ] Install and configure MinIO
  - [ ] S3 bucket structure for SDL data
  - [ ] Worker access to S3 storage
  - [ ] Web UI S3 browser integration

**Projects**
- [ ] Project Management Org Structure
  - [ ] Define project metadata schema
  - [ ] Project lifecycle states (draft, active, archived)
  - [ ] Permission/access control model
- [ ] Experiment Organization under Org Structure
  - [ ] Experiment templates
  - [ ] Parameter tracking
  - [ ] Result linking to experiments
- [ ] HPC Experiment Binary Development
  - [ ] sdl-wkr Capablity detection (phyton, etc)
  - [ ] Binary packaging format
  - [ ] Dependency management
  - [ ] Version control for binaries

**Dashboard Enhancements**
- [x] Dark/Light theme polish (CSS refinements)
- [ ] Real-time resource graphs (Chart.js)
- [ ] Worker status history timeline
- [ ] Cluster health indicators
- [ ] Alert/notification system for worker failures
- [ ] Add a Clock to the Dashboard (ISO 8601)

**Testing & Documentation**
- [ ] Cross-platform testing (Debian, Ubuntu, Arch, Fedora, Win, OSx, BSD)
- [ ] Installation documentation
- [ ] Configuration examples
- [ ] Troubleshooting guide

---

# Design

## Design Goals
- Cross Platform (lnx, mac, win, bsd, rpi) Linux First, support for others later.
- Node.JS based Manager and Worker code bases
- Extreme Minimal OS Dependancies.  sdl-mgr self hosts all the necessary code to deploy and coordinate a cluster.  Including distrubution of Node binaries.
- Automate Update Workflows
- Zero Technical Debt (ideal)
- Sane handling of sdl-workers comming and going, being added or removed.
- Zero sdl-wkr Configuration (ideal) - Install > Run > Listen to UDP Bcast > Auto Join MQTT for cluster command and control.

### Security
- Security considerations TLS, Auth, etc. are future scopes of work.  At this stage we are focused on getting the manager and workers up and running as a Minimum Viable Product (MVP) for a cluster of SDL workers.  But we are also thinking forward about security and cross platform support so those features will be easy to implement later without a major code refactor.
- The current assumption is that SDL runs in a segmented subnet with restricted access.  And that we do not have malicious actors trying to compromise the network or poison the open MQTT broker.


# Architecture

Software Defined Laboratry (SDL)

## Directory Structure

### SDL Source Code Structure
```
../sdl
├── docs
├── sdl-mgr
│   ├── app
│   │   └── modules
│   │       ├── mqtt
│   │       ├── nwa-lib
│   │       ├── sdl-mgr
│   │       ├── template
│   │       └── web
│   ├── conf
│   │   └── modules
│   ├── html
│   │   ├── conf
│   │   ├── css
│   │   ├── img
│   │   ├── js
│   │   └── md
│   └── scripts
├── sdl-wkr
│   ├── app
│   │   └── modules
│   │       ├── nwa-lib
│   │       ├── sdl-wkr
│   │       └── template
│   ├── conf
│   │   └── modules
│   └── scripts
└── tools
```

### SDL Installation Structure
```
~/.sdl/
├── conf
├── data
│   ├── jobs
│   └── proj
├── dist
├── logs
├── nodejs
│   └── current -> /home/jehaverlack/.sdl/nodejs/node-v22.22.0-linux-x64
├── sdl-mgr
│   ├── current -> /home/jehaverlack/.sdl/sdl-mgr/sdl-mgr_0.2.7
│   └── sdl-mgr_0.2.7
│       ├── app
│       │   └── modules
│       │       ├── mqtt
│       │       ├── nwa-lib
│       │       ├── sdl-mgr
│       │       ├── template
│       │       └── web
│       ├── conf
│       │   └── modules
│       ├── html
│       │   ├── conf
│       │   ├── css
│       │   ├── img
│       │   ├── js
│       │   └── md
│       └── scripts
└── sdl-wkr
```


### SDL Worker Install Script
- Curl

### SDL Worker Auto Update Process
- TBD

### SDL Dist Build Process

```
dist
├── sdl-mgr
├── sdl-wkr
├── nodejs-bin
└── installers
```


### Worker Join

- UDP Bcast
- MQTT Join

### Worker Heartbeat

- MQTT Heartbeat

### SDL Storage

- MinIO S3 Storage Server
- this is a non node.js codebase

```
Project
└── Experiment
    ├── L0 Raw Results
    └── L1 Analysis Results
```

```
sdl/
└── projects/
    └── <project_id>/
        └── experiments/
            └── <experiment_id>/
                └── runs/
                    └── <run_id>/
                        ├── l0/
                        └── l1/
```

# Projects
- Need to define structure to manage projects.  
- Projects will be managed with JSON files
- We web UI management Edit interface is nice but will come later. Just need to get things working first.

## Experiments
- Within each Project Scope experiments can be conducted (run) as a specific configuration or permuation of variable to test.
- Each experiment represents a set of parrallized jobs for the cluster to execute on.
- L0 Raw Results will be collected and stored in a run S3 Bucket.
- L1 Analysis Results will be collected and stored in a run S3 Bucket
- L1 Analysis represents an other set of parrallized jobs for the cluster to execute on.

### Run Engine (RE)
 - Run Engines (RE):  May be a Python, Rust, C++, etc. executable/script that is forked by the sdl-wkr Node.JS process.
 - RE get input configuration from the local sdl-wkr process.
 - RE communicate only with the sdl-wkr process.
 - But RE processes may read and write direclty to S3
 - the sdl-wkr process communicates with the SDL Manager (sdl-mgr) process to notify on status of jobs.




```
PENDING
→ ASSIGNED
→ RUNNING
→ DONE | FAILED | CANCELLED
```