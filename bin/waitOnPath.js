import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isLinked = !__dirname.includes('node_modules');

// For linked: project root is one level up
// For installed: project root is several levels up (find real root)
const projectRoot = isLinked
  ? join(__dirname, '..')
  : join(__dirname.split('node_modules')[0]);

// Safely resolve the wait-on binary
const waitOnPath = join(projectRoot, 'node_modules', '.bin', 'wait-on');

// Optional: verify it exists
if (!existsSync(waitOnPath)) {
  throw new Error(`wait-on not found at ${waitOnPath}`);
}

export default waitOnPath;
