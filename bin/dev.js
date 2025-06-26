#!/usr/bin/env node
import { spawn } from 'child_process';
import chokidar from 'chokidar';
import devPath from './devPath.js';

let devProcess;

function startDevServer() {
  devProcess = spawn('node', [devPath, '--watch'], {
    stdio: 'inherit'
  });

  /*
  devProcess.on('exit', (code) => {
    if (code !== 0) {
      console.log(`Dev server exited with code ${code}`);
    }
  });*/
}

function restartDevServer() {
  if (devProcess) {
    devProcess.kill();
    devProcess.on('exit', () => {
      console.log('🔄 Restarting dev server...');
      startDevServer();
    });
  } else {
    startDevServer();
  }
}

// Start once
startDevServer();

// Watch config
chokidar.watch('auto-scope.config.js').on('change', () => {
  console.log('Detected config change');
  restartDevServer();
});