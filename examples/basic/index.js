import { Mp3MediaRecorder } from 'mp3-mediarecorder';

const buttons = {
    record: document.getElementById('record'),
    stop: document.getElementById('stop'),
    pause: document.getElementById('pause'),
    resume: document.getElementById('resume'),
};
const recordings = document.getElementById('recordings');
const errorBox = document.getElementById('error');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
const duration = document.getElementById('duration');

const enabledButtons = {
    inactive: ['record'],
    recording: ['stop', 'pause'],
    paused: ['stop', 'resume'],
};

const statusLabels = { inactive: 'Ready', recording: 'Recording', paused: 'Paused' };

// Elapsed recording time excludes pauses: accumulate finished segments, track the running one by its start time.
const timer = { elapsed: 0, segmentStart: null };

const formatDuration = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
};

const renderDuration = () => {
    const running = timer.segmentStart === null ? 0 : Date.now() - timer.segmentStart;
    duration.textContent = formatDuration(timer.elapsed + running);
};

setInterval(renderDuration, 200);

const setState = (state) => {
    if (state === 'recording') {
        timer.segmentStart = Date.now();
    } else if (timer.segmentStart !== null) {
        timer.elapsed += Date.now() - timer.segmentStart;
        timer.segmentStart = null;
    }
    status.dataset.state = state;
    statusText.textContent = statusLabels[state];
    renderDuration();
    Object.entries(buttons).forEach(([name, button]) => {
        const enabled = enabledButtons[state].includes(name);
        button.disabled = !enabled;
        button.classList.toggle('is-disabled', !enabled);
    });
};

const showError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = false;
    setState('inactive');
};

const microphoneErrors = {
    NotAllowedError: 'Microphone access was denied. Allow it in your browser settings and try again.',
    NotFoundError: 'No microphone found. Check that one is connected and that your OS allows this browser to use it.',
    NotReadableError: 'The microphone is in use by another application.',
    SecurityError: 'Microphone access requires a secure context (https:// or localhost).',
};

const unsupportedReason = () => {
    if (!window.isSecureContext) return microphoneErrors.SecurityError;
    if (!navigator.mediaDevices?.getUserMedia) return 'This browser does not support getUserMedia.';
    if (typeof WebAssembly?.instantiate !== 'function') return 'This browser does not support WebAssembly.';
    if (typeof AudioWorkletNode === 'undefined' && typeof ScriptProcessorNode === 'undefined') {
        return 'This browser does not support the Web Audio API.';
    }
    return null;
};

const addRecording = (blob) => {
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = URL.createObjectURL(blob);
    recordings.appendChild(audio);
};

const unsupported = unsupportedReason();
if (unsupported) {
    showError(unsupported);
} else {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onerror = (event) => showError(`Worker failed to load: ${event.message ?? 'unknown error'}`);

    let recorder = null;

    buttons.record.addEventListener('click', async () => {
        errorBox.hidden = true;
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
        } catch (error) {
            showError(microphoneErrors[error.name] ?? `Could not access the microphone: ${error.message}`);
            return;
        }

        recorder = new Mp3MediaRecorder(stream, { worker });
        timer.elapsed = 0;
        recorder.onstart = () => setState('recording');
        recorder.onpause = () => setState('paused');
        recorder.onresume = () => setState('recording');
        recorder.ondataavailable = (event) => addRecording(event.data);
        recorder.onstop = () => {
            stream.getTracks().forEach((track) => track.stop());
            setState('inactive');
        };
        recorder.onerror = (event) => {
            stream.getTracks().forEach((track) => track.stop());
            showError(`Recording failed: ${event.error?.message ?? 'unknown error'}`);
        };
        recorder.start();
    });

    buttons.stop.addEventListener('click', () => recorder.stop());
    buttons.pause.addEventListener('click', () => recorder.pause());
    buttons.resume.addEventListener('click', () => recorder.resume());
}
