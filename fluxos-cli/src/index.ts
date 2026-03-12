#!/usr/bin/env node

import { runCli } from './cli.js';

runCli(process.argv.slice(2))
  .then((exitCode) => {
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`flux failed: ${message}\n`);
    process.exitCode = 1;
  });
