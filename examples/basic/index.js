import { Mp3MediaRecorder } from '../../dist/mp3-mediarecorder.esm.js';

const recordButton = document.getElementById('record');
const stopButton = document.getElementById('stop');
const recordings = document.getElementById('recordings');
let empty = document.getElementById('empty');

let isRecording = false;
let recorder = null;
let blobs = [];
let mediaStream = null;

const removeEmpty = () => {
    if (empty) {
        recordings.removeChild(empty);
        empty = null;
    }
};

const addRecording = () => {
    const mp3Blob = new Blob(blobs, { type: 'audio/mpeg' });
    const mp3BlobUrl = URL.createObjectURL(mp3Blob);
    const audio = new Audio();
    audio.src = mp3BlobUrl;
    recordings.appendChild(audio);
};

const toggleButtons = () => {
    isRecording = !isRecording;
    stopButton.style.display = isRecording ? 'block' : 'none';
    recordButton.style.display = isRecording ? 'none' : 'block';
};

recordButton.addEventListener('click', () => {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(
        stream => {
            toggleButtons();
            mediaStream = stream;
            recorder = new Mp3MediaRecorder(stream);
            recorder.start();

            recorder.ondataavailable = data => {
                blobs.push(data);
            };

            recorder.onstop = () => {
                removeEmpty();
                addRecording();
            };
        },
        reason => {
            console.warn('Could not get microphone access.\nError:', reason.message);
        }
    );
});

stopButton.addEventListener('click', () => {
    toggleButtons();
    mediaStream.getTracks().forEach(track => track.stop());
    recorder.stop();
});
