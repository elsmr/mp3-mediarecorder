import cc from 'classcat';
import { Mp3MediaRecorder } from 'mp3-mediarecorder';
import { useEffect, useRef, useState } from 'react';
import './App.css';

const microphoneErrors = {
    NotAllowedError: 'Microphone access was denied. Allow it in your browser settings and try again.',
    NotFoundError: 'No microphone found. Check that one is connected and that your OS allows this browser to use it.',
    NotReadableError: 'The microphone is in use by another application.',
    SecurityError: 'Microphone access requires a secure context (https:// or localhost).',
};

const statusLabels = { inactive: 'Ready', recording: 'Recording', paused: 'Paused' };

const formatDuration = (ms) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const seconds = String(totalSeconds % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
};

// Counts up while `running`, holds its value across pauses, `reset` starts over.
const useStopwatch = (running) => {
    const [elapsed, setElapsed] = useState(0);
    const accumulated = useRef(0);
    useEffect(() => {
        if (!running) return;
        const startedAt = Date.now();
        const id = setInterval(() => setElapsed(accumulated.current + Date.now() - startedAt), 200);
        return () => {
            clearInterval(id);
            accumulated.current += Date.now() - startedAt;
        };
    }, [running]);
    const reset = () => {
        accumulated.current = 0;
        setElapsed(0);
    };
    return [elapsed, reset];
};

const Button = ({ enabled, className, onClick, children }) => (
    <div>
        <button
            className={cc(['nes-btn', className, { 'is-disabled': !enabled }])}
            disabled={!enabled}
            onClick={onClick}
        >
            {children}
        </button>
    </div>
);

function App() {
    const recorderRef = useRef(null);
    const workerRef = useRef(null);
    const [recordings, setRecordings] = useState([]);
    const [state, setState] = useState('inactive');
    const [error, setError] = useState(null);
    const [elapsed, resetElapsed] = useStopwatch(state === 'recording');

    useEffect(() => {
        const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        worker.onerror = (event) => setError(`Worker failed to load: ${event.message ?? 'unknown error'}`);
        workerRef.current = worker;
        return () => worker.terminate();
    }, []);

    const onRecord = async () => {
        setError(null);
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (err) {
            setError(microphoneErrors[err.name] ?? `Could not access the microphone: ${err.message}`);
            return;
        }

        const recorder = new Mp3MediaRecorder(stream, { worker: workerRef.current });
        recorderRef.current = recorder;
        resetElapsed();
        recorder.onstart = () => setState('recording');
        recorder.onpause = () => setState('paused');
        recorder.onresume = () => setState('recording');
        recorder.ondataavailable = (event) => setRecordings((prev) => [...prev, URL.createObjectURL(event.data)]);
        recorder.onstop = () => {
            stream.getTracks().forEach((track) => track.stop());
            setState('inactive');
        };
        recorder.onerror = (event) => {
            stream.getTracks().forEach((track) => track.stop());
            setState('inactive');
            setError(`Recording failed: ${event.error?.message ?? 'unknown error'}`);
        };
        recorder.start();
    };

    return (
        <main className="App" id="main">
            <h1>MP3 MediaRecorder</h1>
            {error && <p className="nes-container is-rounded nes-text is-error error">{error}</p>}
            <p className="status" data-state={state}>
                <span className="dot"></span>
                <span>{statusLabels[state]}</span>
                <span className="duration">{formatDuration(elapsed)}</span>
            </p>
            <section className="recordings nes-container with-title">
                <h2 className="title">Recordings</h2>
                {recordings.map((recording) => (
                    <audio key={recording} controls src={recording}></audio>
                ))}
            </section>
            <div className="controls">
                <Button className="is-primary" enabled={state === 'inactive'} onClick={onRecord}>
                    Record
                </Button>
                <Button className="is-error" enabled={state !== 'inactive'} onClick={() => recorderRef.current.stop()}>
                    Stop
                </Button>
                <Button enabled={state === 'paused'} onClick={() => recorderRef.current.resume()}>
                    Resume
                </Button>
                <Button enabled={state === 'recording'} onClick={() => recorderRef.current.pause()}>
                    Pause
                </Button>
            </div>
        </main>
    );
}

export default App;
