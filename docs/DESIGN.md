# Software Defined Laboratory (SDL)

| Attribute | Value |
| --- | --- |
| **Author** | John Haverlack |
| **Copyright** | 2026 John Haverlack |
| **License** | MIT |
| **Version** | 0.3.1 |
| **Date** | 2026-01-31 |


# Roadmap

## Status

- [x] sdl-mgr MQTT Broker
- [x] sdl-mgr UDP Beacon
- [x] sdl-mgr Web UI MQTT WebSocket Pub/Sub
- [x] sdl-wkr UDP Listener


## Prioritized Tasks

MVP - Minimum Viable Product Task List

- [x] SDL_ID Node ID
- [x] Version Updater Script
- [x] Deploy sld-mgr to $SDL_HOME/sdl-mgr
- [ ] Create Worker Join Process
- [ ] Create Worker Heartbeat Process
- [x] Create SDL Worker Dist Build Process
- [x] Create SDL Worker Install to $SDL_HOME
- [x] SDL Install Script
- [ ] Data Storage Organizational Structure
- [ ] MinIO S3 Storage Server
- [ ] Worker Heartbeat Hardware Inventory (CPU, RAM, GPU, etc)
- [ ] Create SDL Worker Auto Update Process
- [ ] Worker Heartbeat Load Status (CPU, RAM, GPU, Disk IO, etc)

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