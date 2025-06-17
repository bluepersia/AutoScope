#!/usr/bin/env node
import { execSync } from 'child_process';

execSync('npx sass src/scss:src/css && npx build && npx vite build', {
  stdio: 'inherit',
});
