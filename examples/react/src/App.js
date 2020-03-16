import cc from 'classcat';
import { Mp3MediaRecorder } from 'mp3-mediarecorder';
import React, { useEffect, useRef, useState } from 'react';
import mp3RecorderWorker from 'workerize-loader!./worker'; // eslint-disable-line import/no-webpack-loader-syntax
import './App.css';

function App() {
    const recorderRef = useRef(null);
    const worker = useRef(null);
    const [recordings, setRecordings] = useState([]);
    const [recorderState, setRecorderState] = useState('inactive');

    useEffect(() => {
        worker.current = mp3RecorderWorker();
    }, []);

    const onRecord = () => {
        window.navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            const recorder = new Mp3MediaRecorder(stream, { worker: worker.current });
            recorderRef.current = recorder;
            recorder.ondataavailable = event => {
                console.log('ondataavailable', event.data);
                setRecordings(prevRecordings => [...prevRecordings, URL.createObjectURL(event.data)]);
            };
            recorder.onstart = () => {
                console.log('onstart');
                setRecorderState('recording');
            };
            recorder.onstop = () => {
                console.log('onstop');
                setRecorderState('inactive');
            };
            recorder.onpause = () => {
                console.log('onpause');
                setRecorderState('paused');
            };
            recorder.onresume = () => {
                console.log('onresume');
                setRecorderState('recording');
            };

            recorder.start();
        });
    };

    const onStop = () => {
        recorderRef.current.stop();
    };

    const onPause = () => {
        recorderRef.current.pause();
    };

    const onResume = () => {
        recorderRef.current.resume();
    };

    return (
        <main className="App" id="main">
            <h1>MP3 MediaRecorder</h1>
            <section className="recordings nes-container with-title">
                <h2 className="title">Recordings</h2>
                {recordings.map(recording => (
                    <audio key={recording} controls src={recording}></audio>
                ))}
            </section>
            <div className="controls">
                <div>
                    <button
                        className={cc(['nes-btn is-primary', { 'is-disabled': recorderState !== 'inactive' }])}
                        onClick={onRecord}
                    >
                        Record
                    </button>
                </div>
                <div>
                    <button
                        className={cc(['nes-btn is-error', { 'is-disabled': recorderState !== 'recording' }])}
                        onClick={onStop}
                    >
                        Stop
                    </button>
                </div>
                <div>
                    <button
                        className={cc(['nes-btn', { 'is-disabled': recorderState !== 'paused' }])}
                        onClick={onResume}
                    >
                        Resume
                    </button>
                </div>
                <div>
                    <button
                        className={cc(['nes-btn', { 'is-disabled': recorderState !== 'recording' }])}
                        onClick={onPause}
                    >
                        Pause
                    </button>
                </div>
            </div>
        </main>
    );
}

export default App;
