# Software Defined Laboratory (SDL)

| Attribute | Value |
| --- | --- |
| **Author** | John Haverlack |
| **Copyright** | 2026 John Haverlack |
| **License** | MIT |
| **Version** | 0.3.0 |
| **Date** | 2026-01-31 |

## Overview

The Software Defined Laboratory (SDL) project provides a generalized distributed computing platform for managing parallel computational workflows across a cluster of distributed nodes.  SDL is a minimalistic High Performance Compute (HPC) platform focused on extreme minimizaton of technical debt associated configuration, deployability, and maintenance of the cluster.

## Design

For more information, see the [Design](docs/DESIGN.md) document.

## Getting Started

## SDL Manager Installation

```
$ git clone https://github.com/jhaverlack/sdl.git
$ cd sdl
$ install-sdl.sh
```

> sdl-mgr is installed to $HOME/.sdl/sdl-mgr

sdl-mgr will be:
- installed to $HOME/.sdl/sdl-mgr
- run as a non-root user (e.g., `sdl-mgr@USER`)
- sets up USER based systemd service

### System D Process
> sdl-mgr runs as a non-root user (e.g., `sdl-mgr@USER`)

```
$ sudo systemctl start sdl-mgr@USER
$ sudo systemctl status sdl-mgr@USER
```

## SDL Worker Installation

Listen to UDP 10101 for beacon messages from SDL Manager.

```
nc -u 127.0.0.1 10101
```

> NOTE: CTRL-C to exit `nc`.  It cannot run on port 10101 in parallel with the sdl-wkr.

Run the **curl** or **wget** command provided by SDL Manager UDP beacon to install SDL Worker locally.

> sdl-wkr is installed to $HOME/.sdl/sdl-wkr

sdl-wrk will be:
- installed to $HOME/.sdl/sdl-wkr
- run as a non-root user (e.g., `sdl-wkr@USER`)
- sets up USER based systemd service
- get's configuration from the sdl-mgr UDP beacon

### System D Process
> sdl-mgr runs as a non-root user (e.g., `sdl-mgr@USER`)

```
$ sudo systemctl start sdl-wkr@USER
$ sudo systemctl status sdl-wkr@USER
```

