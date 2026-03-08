import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DictationController, DictationConfig } from './types.js';
import { shouldSuppressTerminalInput } from './normalize.js';
import { startMacosDictationHelper } from './helper.js';
import { TerminalTranscriptPreview } from './inserter.js';
import { finalizeTranscript, preparePartialTranscript } from './postprocess.js';
import { Cli2VoiceDaemonClient } from '@cli2voice/voice-daemon/client';

export type WrappedCliOptions = {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  dictation: DictationConfig;
  stderr?: NodeJS.WriteStream;
  onExit?: (exitCode: number) => Promise<void> | void;
};

function getPackageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), '..');
}

function getPtyProxyPath(): string {
  return path.join(getPackageRoot(), 'native', 'pty-proxy', 'main.py');
}

async function createDictationController(
  config: DictationConfig,
  injectInput: (value: string | Buffer) => void,
  stderr: NodeJS.WriteStream
): Promise<DictationController> {
  if (!config.enabled || process.platform !== 'darwin') {
    return {
      beforeTerminalInput() {},
      async close() {}
    };
  }

  const client = new Cli2VoiceDaemonClient();
  const preview = new TerminalTranscriptPreview(injectInput);
  let busy = false;
  let queuedAudioPath: string | null = null;

  const cleanupAudioFile = async (audioPath: string | null | undefined): Promise<void> => {
    if (!audioPath) return;
    await fs.rm(audioPath, { force: true }).catch(() => undefined);
  };

  const executeCommand = (binding: DictationConfig['commandMode']['commands'][string]): void => {
    if (binding.startsWith('text:')) {
      injectInput(binding.slice('text:'.length));
      return;
    }

    switch (binding) {
      case 'submit':
        injectInput('\r');
        return;
      case 'backspace':
        injectInput(Buffer.from([0x7f]));
        return;
      case 'clear_line':
        injectInput(Buffer.from([0x15]));
        return;
      case 'escape':
        injectInput('\x1b');
        return;
      case 'tab':
        injectInput('\t');
        return;
    }
  };

  const applyFinalTranscript = (text: string): void => {
    const action = finalizeTranscript(text, config);
    if (action.kind === 'noop') {
      preview.clear();
      return;
    }

    if (action.kind === 'command') {
      preview.clear();
      executeCommand(action.binding);
      return;
    }

    preview.commit(action.text);
  };

  const transcribeAndInject = async (audioPath: string): Promise<void> => {
    try {
      const transcript = await client.transcribeDictation({ audioPath });
      applyFinalTranscript(transcript.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(
        `cli2voice dictation: transcription failed: ${
          message === 'Not found.' ? 'The running cli2voice daemon is outdated. Restart the daemon and try again.' : message
        }\n`
      );
    } finally {
      await cleanupAudioFile(audioPath);
    }
  };

  const drainQueue = async (initialAudioPath: string): Promise<void> => {
    let currentAudioPath: string | null = initialAudioPath;
    busy = true;

    try {
      while (currentAudioPath) {
        const activeAudioPath = currentAudioPath;
        currentAudioPath = null;
        await transcribeAndInject(activeAudioPath);

        if (queuedAudioPath) {
          currentAudioPath = queuedAudioPath;
          queuedAudioPath = null;
        }
      }
    } finally {
      busy = false;
    }
  };

  const helper = await startMacosDictationHelper(config, async (event) => {
    if (event.type === 'error') {
      preview.clear();
      stderr.write(`cli2voice dictation helper: ${event.message}\n`);
      return;
    }

    if (event.type === 'recording_started') {
      if (event.backend === 'macos_native') {
        preview.clear();
      }
      return;
    }

    if (event.type === 'transcript_partial') {
      preview.preview(preparePartialTranscript(event.text, config));
      return;
    }

    if (event.type === 'transcript_final') {
      applyFinalTranscript(event.text);
      return;
    }

    if (event.type === 'transcript_empty') {
      preview.clear();
      return;
    }

    if (event.type !== 'recording_stopped' || event.backend !== 'daemon_whisper' || !event.audioPath) {
      return;
    }

    if (busy) {
      const supersededAudioPath = queuedAudioPath;
      queuedAudioPath = event.audioPath;
      await cleanupAudioFile(supersededAudioPath);
      return;
    }

    void drainQueue(event.audioPath);
  });

  return {
    beforeTerminalInput() {
      preview.clear();
    },
    async close() {
      preview.clear();
      await cleanupAudioFile(queuedAudioPath);
      queuedAudioPath = null;
      await helper.close();
    }
  };
}

export async function runWrappedCli(options: WrappedCliOptions): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Wrapped dictation mode requires an interactive TTY.');
  }

  const stderr = options.stderr ?? process.stderr;
  const wrappedProcess = spawn(
    'python3',
    [
      getPtyProxyPath(),
      '--cwd',
      options.cwd ?? process.cwd(),
      '--cols',
      String(process.stdout.columns || 80),
      '--rows',
      String(process.stdout.rows || 24),
      '--',
      options.command,
      ...options.args
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...options.env }).filter((entry): entry is [string, string] =>
          typeof entry[1] === 'string'
        )
      )
    }
  );

  wrappedProcess.stderr.on('data', (chunk) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (text) {
      stderr.write(text);
    }
  });

  const injectText = (value: string | Buffer) => {
    wrappedProcess.stdin.write(value);
  };

  const dictation = await createDictationController(options.dictation, injectText, stderr).catch((error) => {
    stderr.write(
      `cli2voice dictation unavailable: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return {
      beforeTerminalInput() {},
      async close() {}
    };
  });

  if (!wrappedProcess.stdin || !wrappedProcess.stdout) {
    throw new Error('Wrapped dictation mode failed to initialize process I/O.');
  }

  const previousRawMode = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const onStdinData = (chunk: Buffer) => {
    if (shouldSuppressTerminalInput(chunk, options.dictation.enabled, options.dictation.shortcut)) {
      return;
    }
    dictation.beforeTerminalInput();
    wrappedProcess.stdin.write(chunk);
  };

  process.stdin.on('data', onStdinData);

  wrappedProcess.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
  });

  let exitCode = 0;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      wrappedProcess.once('error', (error) => {
        stderr.write(`cli2voice wrapped process failed: ${error.message}\n`);
        reject(error);
      });
      wrappedProcess.once('exit', (code) => resolve(code ?? 1));
      wrappedProcess.once('close', (code) => resolve(code ?? 1));
    });
  } finally {
    process.stdin.off('data', onStdinData);
    if (previousRawMode === false) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    wrappedProcess.stdin.end();
    await dictation.close();
  }

  await options.onExit?.(exitCode);
  process.exitCode = exitCode;
}
