#!/usr/bin/env node
import {execSync} from 'child_process';

execSync('npx build && npx vite build', {
  stdio: 'inherit',
});
