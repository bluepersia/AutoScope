#!/usr/bin/env node

import http from 'http';

try {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3012,
        path: '/build',
        method: 'POST',
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', async () => {
            console.log ('Success')
        });
      }
    );

    req.on('error', async (err) => {

    });

    req.end();
  } finally {
  }