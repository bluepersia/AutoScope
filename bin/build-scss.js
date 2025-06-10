#!/usr/bin/env node
import {execSync } from 'child_process';


execSync ('sass sass src/scss:src/css && npx build', { 
    stdio: 'inherit'
})