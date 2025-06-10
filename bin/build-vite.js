#!/usr/bin/env node
import execSync from 'child_process';

execSync('npx build --noJS && npx vite build', {
  stdio: 'inherit',
});
