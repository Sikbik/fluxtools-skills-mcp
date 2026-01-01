#!/usr/bin/env node

/*
Build a `zelidauth` header JSON string.

Usage:
  node scripts/build-zelidauth.js --zelid <ZELID> --signature <SIG> --login-phrase <PHRASE>

Notes:
- Prints a compact JSON string suitable for use as the `zelidauth` header value.
- Does not perform signing; signing is done in the user wallet (Zelcore, etc.).
*/

function usage(exitCode = 1) {
  process.stderr.write(
    'Usage: build-zelidauth.js --zelid <ZELID> --signature <SIG> --login-phrase <PHRASE>\n'
  );
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

const args = parseArgs(process.argv);

const zelid = args.zelid;
const signature = args.signature;
const loginPhrase = args['login-phrase'] || args.loginPhrase;

if (!zelid || !signature || !loginPhrase) usage();

process.stdout.write(
  JSON.stringify({
    zelid,
    signature,
    loginPhrase,
  })
);
