import { spawn } from 'child_process';

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export interface RunCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCommand(cmd: string, timeoutMs: number = 300000): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const shell = spawn('bash', ['-c', cmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    shell.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    shell.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      shell.kill('SIGKILL');
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    shell.on('exit', (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 1, stdout, stderr });
    });

    shell.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
