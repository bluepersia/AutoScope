#!/usr/bin/env node
import os from 'os';
import crypto from 'crypto';

function getMachineTagId(length = 4) {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (!net.internal && net.mac !== '00:00:00:00:00:00') {
        const hash = crypto
          .createHash('sha1')
          .update(net.mac)
          .digest('hex');
        return hash.slice(0, length); // e.g., "3f2a"
      }
    }
  }

  return 'anon'; // Fallback if no MAC found
}

console.log(getMachineTagId()); 