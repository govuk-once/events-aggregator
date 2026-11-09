import { spawn } from 'node:child_process';

export const Colors = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  purple: (s: string) => `\x1b[35m${s}\x1b[0m`,
  orange: (s: string) => `\x1b[38;5;214m${s}\x1b[0m`,
};

export function execute(
  label: string,
  args: string[],
): Promise<[string, number, number]> {
  return new Promise((resolve) => {
    const start = Date.now();
    const [cmd, ...cmdArgs] = args;
    const child = spawn(cmd!, cmdArgs, { stdio: ['inherit', 'pipe', 'pipe'] });

    const prefixLines = (
      stream: NodeJS.ReadableStream,
      out: NodeJS.WriteStream,
    ) => {
      let buf = '';
      stream.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          out.write(`${label} ${line}\n`);
        }
      });
      stream.on('end', () => {
        if (buf) out.write(`${label} ${buf}\n`);
      });
    };

    prefixLines(child.stdout, process.stdout);
    prefixLines(child.stderr, process.stderr);

    child.on('close', (code) =>
      resolve([label, code ?? 1, Date.now() - start]),
    );
  });
}
