import serveIndex from 'serve-index';
import open from 'open';
const module = 'web'; // Module Name
import { load_config, log } from '../nwa-lib/index.js';
const config = load_config();

log(`${module}: Loaded module: ${module}`);

import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import express from 'express';
const app = express();


// Serve config as JSON
app.get('/api/config', (req, res) => {
    res.json(config);

    let webreqmeta = {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    };

    log(module + ':  WEBAPI: ' + JSON.stringify(webreqmeta))
});

// Serve sidepanel nav as JSON
app.get('/api/nav/sidepanel', (req, res) => {
  const sideMenuPath = path.join(
    config.dirs.html,
    'conf',
    'nav-sidepanel.json'
  );

  try {
    const sideMenuData = JSON.parse(
      fs.readFileSync(sideMenuPath, 'utf8')
    );
    res.json(sideMenuData);

    log(module + ':  INFO: GET /api/nav/sidepanel');
  } catch (err) {
    log(`ERROR: GET /api/nav/sidepanel failed: ${err}`);
    res.status(500).json({ error: 'Failed to load nav-sidepanel.json' });
  }
});


// Serve nav as JSON
app.get('/api/nav', (req, res) => {
    const menuPath = (path.join(config.dirs.html, 'conf', 'nav.json'));
  
    try {
      const menuData = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
      res.json(menuData);
  
      log(module + ':  INFO: GET /api/nav');
    } catch (err) {
      log(`ERROR: GET /api/nav failed: ${err}`);
      res.status(500).json({ error: 'Failed to load nav.json' });
    }
});

// API
app.get ('/api', (req, res) => {
   res.json(gen_api_usage(req));
   
   let webreqmeta = {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    };

    log(module + ':  WEBAPI: ' + JSON.stringify(webreqmeta))
});


// Distribution
app.use(
  '/dist',
  logStaticRequests('dist'),
  express.static(config.dirs.dist),
  serveIndex(config.dirs.dist, {
    icons: true,
    view: 'details'
  })
);

// /img
app.use('/img', logStaticRequests('img'), express.static(path.join(config.dirs.html, 'img')));

// /css
app.use('/css', logStaticRequests('css'), express.static(path.join(config.dirs.html, 'css')));

// /js
app.use('/js', logStaticRequests('js'), express.static(path.join(config.dirs.html, 'js')));


// md
app.use('/md', logStaticRequests('md'), express.static(path.join(config.dirs.html, 'md')));


// Web Libs
for (let wl in config.modules.web.weblibs) {
  log(`${module}: Serving WebLib: /${wl} at  ${path.join(config.dirs.app, 'node_modules', config.modules.web.weblibs[wl])}`)
  app.use('/' + wl, logStaticRequests(wl), express.static(path.join(config.dirs.app, 'node_modules', config.modules.web.weblibs[wl])));  
}


// Top Level Website
app.use('/', logStaticRequests('html'), express.static(path.join(config.dirs.html)));

// Catch-all for 404 Not Found
app.use((req, res, next) => {
    const webreqmeta = {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    };
  
    log(`404 NOT FOUND: ${JSON.stringify(webreqmeta)}`);
  
    if (req.originalUrl.startsWith('/api/')) {
      res.status(404).json({ error: 'Not Found', path: req.originalUrl });
    } else {
      res.status(404).sendFile(path.join(config.dirs.html, '404.html'));
    }
  });
  
 // Starting Web Server
const bindAddrs =
  Array.isArray(config.modules[module].bind_ip_addrs) &&
  config.modules[module].bind_ip_addrs.length > 0
    ? config.modules[module].bind_ip_addrs
    : ['0.0.0.0'];

for (const ip_addr of bindAddrs) {
  if (ip_addr === '0.0.0.0') {
    const server = app.listen(config.modules[module].port, '0.0.0.0', () => {
      for (const ip of config.host.ips) {
        log(`INFO: WebUI running at http://${ip}:${config.modules[module].port}`, true);

        if (config.modules[module].open_browser && ip === '127.0.0.1') {
          open(`http://127.0.0.1:${config.modules[module].port}`);
        }
      }
    });

    server.on('error', (err) => {
      log(`ERROR: WebUI failed to start on 0.0.0.0:${config.modules[module].port}: ${err}`, true);
    });
  } else {
    const server = app.listen(config.modules[module].port, ip_addr, () => {
      log(`INFO: WebUI running at http://${ip_addr}:${config.modules[module].port}`, true);
      if (config.modules[module].open_browser) {
        open(`http://${ip_addr}:${config.modules[module].port}`);
      }
    });

    server.on('error', (err) => {
      log(`ERROR: WebUI failed to start on ${ip_addr}:${config.modules[module].port}: ${err}`, true);
    });
  }
}





// ----------- Libraries -------------
  function logStaticRequests(subdir) {
    const func = 'logStaticRequests';
    return (req, res, next) => {
      const webreqmeta = {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        type: subdir
      };
      log(`${module}: ${func}: Web Req: ${JSON.stringify(webreqmeta)}`);
      next();
    };
  }


      // API Usage
function gen_api_usage(req) {
  // let base_url = "http://localhost:" + config.web.port;
  const base_url = `${req.protocol}://${req.headers.host}`;
  let usage = {};

  usage['API'] = {}
  usage['API']['DESC']   = "API"
  usage['API']['URL']    = base_url + '/api';

  usage['API']['CONFIG'] = {}
  usage['API']['CONFIG']['DESC'] = "API Config JSON"
  usage['API']['CONFIG']['URL'] = base_url + '/api/config';

  return usage;
}
