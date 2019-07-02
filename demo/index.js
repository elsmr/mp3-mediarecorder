const startButton = document.getElementById('record');
const stopButton = document.getElementById('stop');
const pauseButton = document.getElementById('pause');
const resumeButton = document.getElementById('resume');
const recordings = document.getElementById('recordings');
const main = document.getElementById('main');

let isRecording = false;
let recorder = null;
let blobs = [];
let mediaStream = null;
let isPaused = false;
let Mp3MediaRecorder = null;
const supportsWasm = WebAssembly && typeof WebAssembly.instantiate === 'function';
const supportsUserMediaAPI = navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
const isBrowserSupported = supportsWasm && supportsUserMediaAPI;

if (isBrowserSupported) {
    window.mp3MediaRecorder
        .getMp3MediaRecorder({ wasmURL: 'https://unpkg.com/vmsg@0.3.5/vmsg.wasm' })
        .then(recorderClass => {
            Mp3MediaRecorder = recorderClass;
            startButton.classList.remove('is-disabled');
        });

    startButton.addEventListener('click', () => {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(
            stream => {
                mediaStream = stream;
                recorder = new Mp3MediaRecorder(stream);
                recorder.start();

                recorder.onstart = e => {
                    console.log('onstart', e);
                    blobs = [];
                    startButton.classList.add('is-disabled');
                    stopButton.classList.remove('is-disabled');
                    pauseButton.classList.remove('is-disabled');
                };

                recorder.ondataavailable = e => {
                    console.log('ondataavailable', e);
                    blobs.push(e.data);
                };

                recorder.onstop = e => {
                    console.log('onstop', e);
                    mediaStream.getTracks().forEach(track => track.stop());

                    startButton.classList.remove('is-disabled');
                    pauseButton.classList.add('is-disabled');
                    stopButton.classList.add('is-disabled');

                    const mp3Blob = new Blob(blobs, { type: 'audio/mpeg' });
                    const mp3BlobUrl = URL.createObjectURL(mp3Blob);
                    const audio = new Audio();
                    audio.controls = true;
                    audio.src = mp3BlobUrl;
                    recordings.appendChild(audio);
                };

                recorder.onpause = e => {
                    console.log('onpause', e);
                    resumeButton.classList.remove('is-disabled');
                    pauseButton.classList.add('is-disabled');
                };

                recorder.onresume = e => {
                    console.log('onresume', e);
                    resumeButton.classList.add('is-disabled');
                    pauseButton.classList.remove('is-disabled');
                };

                recorder.onerror = e => {
                    console.error('onerror', e);
                };
            },
            reason => {
                console.warn('Could not get microphone access.\nError:', reason.message);
            }
        );
    });

    stopButton.addEventListener('click', () => {
        recorder.stop();
    });

    pauseButton.addEventListener('click', () => {
        recorder.pause();
    });

    resumeButton.addEventListener('click', () => {
        recorder.resume();
    });
} else {
    const renderError = reason => {
        const clonedMain = main.cloneNode(false);
        clonedMain.innerHTML = `
            <h1 class="nes-text is-error">MP3 MediaRecorder is not supported</h1>
            <p class="nes-text">
                ${reason}
            </p>
        `;
        main.parentNode.replaceChild(clonedMain, main);
    };

    if (!supportsUserMediaAPI) {
        renderError(
            'MP3 MediaRecorder requires the <a href="https://developer.mozilla.org/en-US/docs/Web/API/Media_Streams_API" class="nes-text is-error">getUserMedia API</a> but it is not supported in your browser.'
        );
    } else if (!supportsWasm) {
        renderError(
            'MP3 MediaRecorder requires <a href="https://developer.mozilla.org/en-US/docs/WebAssembly" class="nes-text is-error">WebAssembly</a> but it is not supported in your browser.'
        );
    }
}
