import { Mp3MediaRecorder } from 'mp3-mediarecorder';
import React, { useRef, useState } from 'react';
import worker from 'workerize-loader!./worker'; // eslint-disable-line import/no-webpack-loader-syntax
import './App.css';

function App() {
    const recorderRef = useRef(null);
    const [audioUrl, setAudioUrl] = useState(null);
    const [isRecording, setIsRecording] = useState(false);

    const onRecord = () => {
        window.navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            const recorder = new Mp3MediaRecorder(stream, { worker: worker() });
            recorderRef.current = recorder;
            recorder.ondataavailable = event => {
                console.log('ondataavailable', event.data);
                setAudioUrl(URL.createObjectURL(event.data));
            };
            recorder.onstart = () => {
                console.log('onstart');
                setIsRecording(true);
            };
            recorder.onstop = () => {
                console.log('onstop');
                setIsRecording(false);
            };
            console.log('start');
            recorder.start();
        });
    };

    const onStop = () => {
        recorderRef.current.stop();
    };

    return (
        <div className="App">
            <h1>React Recorder</h1>
            {!isRecording ? <button onClick={onRecord}>Record</button> : <button onClick={onStop}>Stop</button>}
            {audioUrl && <audio src={audioUrl}></audio>}
        </div>
    );
}

export default App;
