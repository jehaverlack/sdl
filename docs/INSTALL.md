
# Software Defined Laboratory (SDL)

> NOTE: This is a work in progress.  SDL has only been tested on Debian based 
> Linux systems.  But has been designed to be cross platform.  So running on
> other platforms should not be a heavy lift.

Other than basic OS tools, SDL downloads all dependencies idempotently and installs
everything into a single SDL home directory (~/.sdl).

---

## SDL Manager (sdl-mgr)

#### Installation

```
git clone <SDL_REPO_URL>
```

```
cd sdl
```

```
./install-sdl.sh
```

#### Upgrading

```
cd sdl
```

```
git pull origin main
```

```
./install-sdl.sh
```

---

## SDL Worker (sdl-wkr)

#### Prerequisites 

(Debian, Ubuntu, Linux Mint, Zorin OS, Raspbian)

```
sudo apt -y install gawk coreutils curl jq grep sed tar unzip netcat-openbsd
```

#### Installation 

(Linux, OSX, Windows(WSL2))

Listen to UDP Broadcast on port 10101
- To get the **sld-wkr** curl or wget install command

```
nc -u -l -k 10101
```

OR 

```
nc -u -l -k 10101 |jq
{
  "ts": "2026-01-31T05:20:31.815Z",
  "sdl_id": "906a027c-52f0-4cbb-b3e0-5eb84856d50a",
  "role": "sdl-mgr",
  "host": "haverlab-sld-mgr",
  "type": "udp-beacon",
  "msg": {
    "info": {
      "desc": "Software Defined Laboratory: Manager (sdl-mgr)",
      "version": "0.2.10",
      "copyright": "2026 John Haverlack"
    },
    "cluster": {
      "id": "haverlab",
      "name": "Haverlab",
      "desc": "John Haverlack's Home Lab"
    },
    "mqtt": {
      "host": "10.0.0.178",
      "port": 1883
    },
    "web": {
      "proto": "http",
      "host": "10.0.0.178",
      "port": 8081,
      "api_config": "/api/config",
      "config_url": "http://10.0.0.178:8081/api/config"
    },
    "sdl_wkr_install_cmd": {
      "curl": "curl -s http://10.0.0.178:8081/dist/install-sdl-wkr.sh | bash -s 10.0.0.178",
      "wget": "wget -O - http://10.0.0.178:8081/dist/install-sdl-wkr.sh | bash -s 10.0.0.178"
    }
  }
}

```

```
curl -s http://<SDL_MGR_IP>:<WEB_PORT>/dist/install-sdl-wkr.sh | bash -s <SDL_MGR_IP>
```

#### Upgrading

SDL Workers continuously monitor the SDL Manager’s advertised version via MQTT cluster status messages and will automatically re-install and restart when a newer version is detected.

Alternatively you can upgrade manually by rerunning the install-sdl-wkr.sh script.

```
curl -s http://<SDL_MGR_IP>:<WEB_PORT>/dist/install-sdl-wkr.sh | bash -s <SDL_MGR_IP>
```
