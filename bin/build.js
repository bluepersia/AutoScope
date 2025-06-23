#!/usr/bin/env node
import path from 'path';
import { build } from '../index.js';
import loadConfig from './loadConfig.js';


  const config = await await loadConfig ();

  const args = process.argv.slice(2);
  const noJS = args.includes('--noJS');

  if (noJS)
    config.copyJs = false;

  try {

    await build( config ); // Wait here before continuing
    console.log('✅ Build complete');

    // You can now run other commands here synchronously
    // e.g., start Webpack or Sass watchers

  } catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
  }

