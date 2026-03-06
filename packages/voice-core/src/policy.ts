import type {
  DefaultVoiceMode,
  EvaluatedCandidate,
  SessionAction,
  SessionControlSignal,
  SessionVoiceState
} from './types.js';

export function createSessionVoiceState(defaultMode: DefaultVoiceMode = 'plan'): SessionVoiceState {
  return {
    defaultMode,
    planMode: false,
    manualVoiceOverride: null
  };
}

export function isSessionVoiceEnabled(state: SessionVoiceState): boolean {
  if (state.manualVoiceOverride === 'on') return true;
  if (state.manualVoiceOverride === 'off') return false;

  switch (state.defaultMode) {
    case 'always':
      return true;
    case 'off':
      return false;
    case 'plan':
    default:
      return state.planMode;
  }
}

export function reduceSessionVoiceState(
  state: SessionVoiceState,
  signal: SessionControlSignal
): SessionVoiceState {
  switch (signal) {
    case 'plan_enter':
      return { ...state, planMode: true };
    case 'plan_exit':
      return { ...state, planMode: false };
    case 'manual_voice_on':
      return { ...state, manualVoiceOverride: 'on' };
    case 'manual_voice_off':
      return { ...state, manualVoiceOverride: 'off' };
    case 'manual_voice_default':
      return { ...state, manualVoiceOverride: null };
    default:
      return state;
  }
}

export function evaluateSessionActions(
  actions: SessionAction[],
  initialState: SessionVoiceState = createSessionVoiceState()
): { state: SessionVoiceState; candidates: EvaluatedCandidate[] } {
  let state = { ...initialState };
  const candidates: EvaluatedCandidate[] = [];

  for (const action of actions) {
    if (action.kind === 'control') {
      state = reduceSessionVoiceState(state, action.signal);
      continue;
    }

    candidates.push({
      message: action.message,
      shouldSpeak: isSessionVoiceEnabled(state),
      line: action.line,
      source: action.source
    });
  }

  return { state, candidates };
}
