const module = 'TEMPLATE'; // Module Name
import { load_config, log } from '../nwa-lib/index.js';
const config = load_config();

log(`Loaded module: ${module}`);