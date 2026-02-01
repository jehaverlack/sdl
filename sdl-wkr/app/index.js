// Node Web Application (NWA)
// John Haverlack <john@haverlack.net>
// https://github.com/
// LICENSE: MIT
// Copyright (c) 2025 John Haverlack

import { load_config, log } from './modules/nwa-lib/index.js';

const config = load_config();

log('=======================================================================================');
log(config.package.name + ': STARTING: ' + config.package.description + ' v' + config.package.version);
// log(JSON.stringify(config, null, 2));
// log(JSON.stringify(config.dirs, null, 2), false);

for (let m in config.modules) {
    // log(`Loading module: ${m}`);
    await import(config.modules[m].main);
}



