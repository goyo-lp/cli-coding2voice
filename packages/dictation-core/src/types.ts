export type DictationShortcut = 'right_option' | 'control_v';
export type DictationInsertMode = 'type';
export type DictationBackend = 'auto' | 'macos_native' | 'daemon_whisper';
export type DictationCommandBinding =
  | 'submit'
  | 'backspace'
  | 'clear_line'
  | 'escape'
  | 'tab'
  | `text:${string}`;

export type DictationCommandModeConfig = {
  enabled: boolean;
  wakePhrase: string;
  commands: Record<string, DictationCommandBinding>;
};

export type DictationConfig = {
  enabled: boolean;
  shortcut: DictationShortcut;
  backend: DictationBackend;
  insertMode: DictationInsertMode;
  sttModel: string;
  language: string;
  device: string | null;
  dtype: string | Record<string, string> | null;
  prewarm: boolean;
  partialResults: boolean;
  maxRecordingMs: number;
  dictionary: Record<string, string>;
  snippets: Record<string, string>;
  commandMode: DictationCommandModeConfig;
};

export type DictationStatus = {
  enabled: boolean;
  platformSupported: boolean;
  shortcut: DictationShortcut;
  backend: DictationBackend;
  insertMode: DictationInsertMode;
  sttModel: string;
  language: string;
  device: string | null;
  dtype: string | Record<string, string> | null;
  prewarm: boolean;
  partialResults: boolean;
  maxRecordingMs: number;
  dictionary: Record<string, string>;
  snippets: Record<string, string>;
  commandMode: DictationCommandModeConfig;
  helper: {
    sourcePath: string;
    binaryPath: string;
    binaryExists: boolean;
    swiftcAvailable: boolean;
  };
};

export type MacosDictationEvent =
  | {
      type: 'recording_started';
      shortcut: DictationShortcut;
      backend: Exclude<DictationBackend, 'auto'>;
    }
  | {
      type: 'recording_stopped';
      audioPath?: string;
      reason: 'released' | 'timeout';
      shortcut: DictationShortcut;
      backend: Exclude<DictationBackend, 'auto'>;
    }
  | {
      type: 'transcript_partial';
      text: string;
      shortcut: DictationShortcut;
      backend: 'macos_native';
    }
  | {
      type: 'transcript_final';
      text: string;
      shortcut: DictationShortcut;
      backend: 'macos_native';
    }
  | {
      type: 'transcript_empty';
      shortcut: DictationShortcut;
      reason: 'released' | 'timeout';
      backend: 'macos_native';
    }
  | {
      type: 'error';
      message: string;
    };

export type DictationController = {
  beforeTerminalInput(): void;
  close(): Promise<void>;
};
