#!/usr/bin/env node

/*
Build a deterministic “message to sign” and payload scaffold for Flux app register/update.

Usage examples:
  node scripts/build-app-message.js --type fluxappregister --from-verify verify.json --payload-out appregister.json
  node scripts/build-app-message.js --type fluxappupdate --spec-file spec.formatted.json --timestamp 1700000000000

Notes:
- Prints the exact message string to stdout (no trailing newline).
- Writes a JSON payload scaffold with signature placeholder when --payload-out is used.
*/

const fs = require('fs');

function usage(exitCode = 1) {
  const msg = `\
Usage:
  build-app-message.js --type <fluxappregister|fluxappupdate|zelappregister|zelappupdate> [--type-version 1]
                       (--from-verify <verify.json> | --spec-file <spec.json>)
                       [--timestamp <ms>]
                       [--payload-out <file.json>]
                       [--spec-out <file.json>]

Examples:
  node scripts/build-app-message.js --type fluxappregister --from-verify verify.json --payload-out appregister.json
  node scripts/build-app-message.js --type fluxappupdate --spec-file spec.formatted.json --payload-out appupdate.json
`;
  process.stderr.write(msg);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = value;
      i += 1;
    }
  }
  return args;
}

function readJson(path) {
  const raw = fs.readFileSync(path, 'utf8');
  return JSON.parse(raw);
}

const args = parseArgs(process.argv);

const type = args.type;
if (!type) usage();

const validTypes = new Set(['fluxappregister', 'fluxappupdate', 'zelappregister', 'zelappupdate']);
if (!validTypes.has(type)) {
  process.stderr.write(`Invalid --type: ${type}\n`);
  usage();
}

const typeVersion = args['type-version'] ? Number(args['type-version']) : 1;
if (!Number.isFinite(typeVersion)) {
  process.stderr.write('Invalid --type-version\n');
  usage();
}

const fromVerify = args['from-verify'];
const specFile = args['spec-file'];

if ((fromVerify && specFile) || (!fromVerify && !specFile)) {
  process.stderr.write('Provide exactly one of --from-verify or --spec-file\n');
  usage();
}

let spec;
if (fromVerify) {
  const verify = readJson(fromVerify);
  if (!verify || typeof verify !== 'object' || !('data' in verify)) {
    process.stderr.write('Verify JSON must include a top-level "data" field\n');
    process.exit(2);
  }
  spec = verify.data;
} else {
  spec = readJson(specFile);
}

if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
  process.stderr.write('Spec must be a JSON object\n');
  process.exit(2);
}

const timestamp = args.timestamp ? Number(args.timestamp) : Date.now();
if (!Number.isFinite(timestamp)) {
  process.stderr.write('Invalid --timestamp (must be ms epoch)\n');
  process.exit(2);
}

const specJson = JSON.stringify(spec);
const messageToSign = `${type}${typeVersion}${specJson}${timestamp}`;

// stdout: exact bytes to sign
process.stdout.write(messageToSign);

// optional outputs
if (args['spec-out']) {
  fs.writeFileSync(args['spec-out'], `${specJson}\n`, 'utf8');
}

if (args['payload-out']) {
  const payload = {
    type,
    version: typeVersion,
    appSpecification: spec,
    timestamp,
    signature: '<SIGNATURE>',
  };
  fs.writeFileSync(args['payload-out'], `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
