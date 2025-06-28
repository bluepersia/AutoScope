import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const waitOnPath = join(__dirname, '../node_modules/.bin/wait-on');

export default waitOnPath;