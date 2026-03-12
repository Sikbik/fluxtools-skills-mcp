export type TextWriter = {
  write(chunk: string): void;
};

export type CliIo = {
  stdout: TextWriter;
  stderr: TextWriter;
};

export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_VALIDATION = 2;

const HELP_TEXT = `FluxOS CLI

Usage:
  flux [command]

Commands:
  help        Show this help output

Options:
  -h, --help  Show this help output

Package:
  fluxos-cli (Node.js 20+ TypeScript ESM package)
`;

function writeLine(writer: TextWriter, text: string) {
  writer.write(text.endsWith('\n') ? text : `${text}\n`);
}

export function renderHelp(): string {
  return HELP_TEXT;
}

export function runCli(argv: string[], io: CliIo = { stdout: process.stdout, stderr: process.stderr }): number {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    writeLine(io.stdout, renderHelp());
    return EXIT_CODE_SUCCESS;
  }

  const [command] = argv;

  writeLine(io.stderr, `Unknown command: ${command}`);
  writeLine(io.stderr, '');
  writeLine(io.stderr, renderHelp());

  return EXIT_CODE_VALIDATION;
}
