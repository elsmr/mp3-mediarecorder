const recordButton = document.getElementById('record');
const stopButton = document.getElementById('stop');
const recordings = document.getElementById('recordings');
const indicator = document.getElementById('indicator');
const main = document.getElementById('main');
let empty = document.getElementById('empty');

let isRecording = false;
let recorder = null;
let blobs = [];
let mediaStream = null;

window.mp3MediaRecorder
    .getMp3MediaRecorder({ wasmURL: `${window.location.origin}/dist/vmsg.wasm` })
    .then(Mp3MediaRecorder => {
        main.classList.add('main--loaded');

        const removeEmpty = () => {
            if (empty) {
                recordings.removeChild(empty);
                empty = null;
            }
        };

        const addRecording = () => {
            console.log(blobs);
            const mp3Blob = new Blob(blobs, { type: 'audio/mpeg' });
            const mp3BlobUrl = URL.createObjectURL(mp3Blob);
            const audio = new Audio();
            audio.controls = true;
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

                    recorder.onstart = e => {
                        console.log('start', e);
                        blobs = [];
                        indicator.classList.add('indicator--visible');
                    };

                    recorder.ondataavailable = e => {
                        console.log('data', e);
                        blobs.push(e.data);
                    };

                    recorder.onstop = e => {
                        console.log('onstop', e);
                        indicator.classList.remove('indicator--visible');
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
    });
