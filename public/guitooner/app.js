/* Guitooner Core Application Logic */

// Instrument definitions
const INSTRUMENTS = {
  guitar: {
    name: 'Guitar',
    strings: [
      { note: 'E4', freq: 329.63, thickness: 1 },
      { note: 'B3', freq: 246.94, thickness: 1.3 },
      { note: 'G3', freq: 196.00, thickness: 1.8 },
      { note: 'D3', freq: 146.83, thickness: 2.3 },
      { note: 'A2', freq: 110.00, thickness: 2.8 },
      { note: 'E2', freq: 82.41, thickness: 3.5 }
    ]
  },
  bass: {
    name: 'Bass',
    strings: [
      { note: 'G2', freq: 98.00, thickness: 2.0 },
      { note: 'D2', freq: 73.42, thickness: 3.0 },
      { note: 'A1', freq: 55.00, thickness: 4.0 },
      { note: 'E1', freq: 41.20, thickness: 5.0 }
    ]
  }
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// App State
let activeInstrument = 'guitar';
let selectedStringIndex = 0;
let autoDetectString = true;

// Web Audio State
let audioContext = null;
let analyser = null;
let microphone = null;
let hpFilter = null;
let lpFilter = null;
let dataArray = null;
let bufferLength = 0;
let isListening = false;

// Audio synthesis for plucks
let pluckOsc = null;
let pluckGain = null;

// Pitch Smoothing
let consecutiveSilentFrames = 0;
const MAX_SILENT_FRAMES = 15; // Hold state for ~250ms at 60fps to prevent flickering
let lastFrequency = -1;
let lastStringIndex = -1;

// DOM Elements
const btnGuitar = document.getElementById('btn-guitar');
const btnBass = document.getElementById('btn-bass');
const btnAutoString = document.getElementById('btn-auto-string');
const btnAudioAction = document.getElementById('btn-audio-action');
const noteLetterDisp = document.getElementById('note-letter');
const tuningStatusVal = document.getElementById('tuning-status');
const tuningCentsVal = document.getElementById('tuning-cents-val');
const needleGroup = document.getElementById('needle-group');
const canvas = document.getElementById('canvas-visualizer');
const canvasCtx = canvas.getContext('2d');

// Initialize Canvas
function resizeCanvas() {
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Render strings on fretboard
function renderFretboard() {
  const fretboard = document.getElementById('fretboard');
  fretboard.innerHTML = '';
  
  fretboard.className = `fretboard ${activeInstrument}-layout`;
  
  const inst = INSTRUMENTS[activeInstrument];
  inst.strings.forEach((stringInfo, index) => {
    const row = document.createElement('div');
    row.className = 'string-row';
    
    // Highlight if selected and we are in manual mode, or if auto-detected string matches
    if (selectedStringIndex === index && (!autoDetectString || (isListening && lastFrequency !== -1))) {
      row.classList.add('active');
    }
    
    const badge = document.createElement('div');
    badge.className = 'string-badge';
    badge.textContent = stringInfo.note;
    
    const line = document.createElement('div');
    line.className = 'string-line';
    line.style.height = `${stringInfo.thickness}px`;
    
    row.appendChild(badge);
    row.appendChild(line);
    
    // Tap to play reference tone and select manually
    row.addEventListener('click', () => {
      autoDetectString = false;
      btnAutoString.classList.remove('active');
      
      selectedStringIndex = index;
      lastStringIndex = index;
      updateStringVisuals();
      
      playReferenceTone(stringInfo.freq);
      
      // Trigger visual pluck vibration animation
      row.classList.remove('plucked');
      void row.offsetWidth; // Force reflow to reset CSS animation
      row.classList.add('plucked');
      setTimeout(() => row.classList.remove('plucked'), 400);
    });
    
    fretboard.appendChild(row);
  });
}

// Update string active classes
function updateStringVisuals() {
  const rows = document.querySelectorAll('.string-row');
  rows.forEach((row, index) => {
    const isMatched = selectedStringIndex === index && (!autoDetectString || lastFrequency !== -1);
    if (isMatched) {
      row.classList.add('active');
    } else {
      row.classList.remove('active');
    }
  });
}

// Play pluck synth tone
function playReferenceTone(frequency) {
  // Initialize context on interaction if not yet started
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) {
      console.error(e);
      return;
    }
  }
  
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  // Cut off previous note cleanly
  if (pluckOsc) {
    try {
      pluckOsc.stop();
    } catch(e) {}
  }
  
  pluckOsc = audioContext.createOscillator();
  pluckGain = audioContext.createGain();
  
  // Guitar-like warm wave
  pluckOsc.type = 'triangle';
  pluckOsc.frequency.setValueAtTime(frequency, audioContext.currentTime);
  
  // Gain envelope: fast attack, slow exponential decay
  const now = audioContext.currentTime;
  pluckGain.gain.setValueAtTime(0, now);
  pluckGain.gain.linearRampToValueAtTime(0.35, now + 0.015);
  pluckGain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);
  
  pluckOsc.connect(pluckGain);
  pluckGain.connect(audioContext.destination);
  
  pluckOsc.start(now);
  pluckOsc.stop(now + 1.8);
}

// Instrument buttons event listeners
btnGuitar.addEventListener('click', () => {
  if (activeInstrument === 'guitar') return;
  activeInstrument = 'guitar';
  btnGuitar.classList.add('active');
  btnBass.classList.remove('active');
  selectedStringIndex = 0;
  lastFrequency = -1;
  renderFretboard();
  updateFilters();
});

btnBass.addEventListener('click', () => {
  if (activeInstrument === 'bass') return;
  activeInstrument = 'bass';
  btnBass.classList.add('active');
  btnGuitar.classList.remove('active');
  selectedStringIndex = 0;
  lastFrequency = -1;
  renderFretboard();
  updateFilters();
});

btnAutoString.addEventListener('click', () => {
  autoDetectString = !autoDetectString;
  if (autoDetectString) {
    btnAutoString.classList.add('active');
  } else {
    btnAutoString.classList.remove('active');
  }
  updateStringVisuals();
});

// Setup audio nodes
async function initAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    microphone = audioContext.createMediaStreamSource(stream);
    
    // High-pass filter to cut sub-bass room rumble
    hpFilter = audioContext.createBiquadFilter();
    hpFilter.type = 'highpass';
    
    // Low-pass filter to cut high frequency harmonics and noise
    lpFilter = audioContext.createBiquadFilter();
    lpFilter.type = 'lowpass';
    
    // Set filter frequencies based on active instrument
    updateFilters();
    
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 4096; // 4096 samples provides good resolution at low frequencies (~41Hz E1 bass)
    
    // Connection chain: Microphone -> Highpass -> Lowpass -> Analyser
    microphone.connect(hpFilter);
    hpFilter.connect(lpFilter);
    lpFilter.connect(analyser);
    
    bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    
    isListening = true;
    
    // Update UI Elements
    btnAudioAction.classList.remove('pulse-glow');
    btnAudioAction.classList.add('connected');
    btnAudioAction.querySelector('span').textContent = 'Tuner Active';
    
    tuningStatusVal.textContent = 'Listening...';
    document.querySelector('.tuner-card').classList.add('active-tuning');
    
    // Run pitch detection loop
    runTunerLoop();
  } catch(err) {
    console.error('Mic access error: ', err);
    alert(`Microphone Error: ${err.name} - ${err.message}\n\nPlease ensure both your browser and operating system (macOS) have granted microphone permissions.`);
    tuningStatusVal.textContent = 'Mic Error';
  }
}

// Dynamically adjust highpass and lowpass filters depending on active instrument's frequency range
function updateFilters() {
  if (!hpFilter || !lpFilter || !audioContext) return;
  
  const now = audioContext.currentTime;
  if (activeInstrument === 'guitar') {
    // Guitar fundamental range: E2 (82Hz) to E4 (330Hz)
    // Set highpass at 70Hz (cuts floor rumble), lowpass at 420Hz (cuts vocal speech and string squeaks)
    hpFilter.frequency.setValueAtTime(70, now);
    lpFilter.frequency.setValueAtTime(420, now);
  } else {
    // Bass fundamental range: E1 (41Hz) to G2 (98Hz)
    // Set highpass at 35Hz, lowpass at 150Hz
    hpFilter.frequency.setValueAtTime(35, now);
    lpFilter.frequency.setValueAtTime(150, now);
  }
}

btnAudioAction.addEventListener('click', () => {
  if (!isListening) {
    initAudio();
  }
});

// MIDI Note calculator
function getNoteFromFrequency(frequency) {
  const noteNum = 12 * (Math.log2(frequency / 440)) + 69;
  const rounded = Math.round(noteNum);
  const noteName = NOTE_NAMES[rounded % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return { name: noteName, octave: octave, string: `${noteName}${octave}` };
}

// Find closest string in current layout
function getClosestString(frequency, strings) {
  let minDiff = Infinity;
  let closestIndex = 0;
  for (let i = 0; i < strings.length; i++) {
    const diff = Math.abs(Math.log2(frequency / strings[i].freq));
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }
  return closestIndex;
}

// Autocorrelation Pitch Detector
function autoCorrelate(buffer, sampleRate) {
  const SIZE = buffer.length;
  let rms = 0;
  
  // Calculate RMS
  for (let i = 0; i < SIZE; i++) {
    const val = buffer[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  
  // Silence threshold
  if (rms < 0.007) {
    return -1;
  }
  
  // Frequency bounds (guitar & bass ranges, 30Hz - 1000Hz)
  const minFreq = 30;
  const maxFreq = 1000;
  const minPeriod = Math.floor(sampleRate / maxFreq);
  const maxPeriod = Math.ceil(sampleRate / minFreq);
  
  // Standard autocorrelation over a fixed window (2048 samples)
  const windowSize = 2048;
  const correlations = new Float32Array(maxPeriod + 1);
  
  for (let period = minPeriod; period <= maxPeriod; period++) {
    let sum = 0;
    for (let i = 0; i < windowSize; i++) {
      sum += buffer[i] * buffer[i + period];
    }
    correlations[period] = sum;
  }
  
  // Find local maximum peak in the correlations array
  let bestPeriod = -1;
  let maxCorrelation = -Infinity;
  
  for (let period = minPeriod; period <= maxPeriod; period++) {
    if (correlations[period] > correlations[period - 1] && correlations[period] > correlations[period + 1]) {
      if (correlations[period] > maxCorrelation) {
        maxCorrelation = correlations[period];
        bestPeriod = period;
      }
    }
  }
  
  // Calculate zero-lag energy
  let zeroLagEnergy = 0;
  for (let i = 0; i < windowSize; i++) {
    zeroLagEnergy += buffer[i] * buffer[i];
  }
  
  // Peak threshold verification (signals similarity ratio)
  // Higher value (0.55) makes it ignore noisy non-harmonic sounds like talking or fan noise
  if (zeroLagEnergy === 0 || maxCorrelation / zeroLagEnergy < 0.55) {
    return -1;
  }
  
  // Parabolic interpolation for sub-sample accuracy (essential to detect minor cents differences)
  let T0 = bestPeriod;
  if (T0 > minPeriod && T0 < maxPeriod) {
    const alpha = correlations[T0 - 1];
    const beta = correlations[T0];
    const gamma = correlations[T0 + 1];
    const denominator = 2 * beta - alpha - gamma;
    if (denominator !== 0) {
      T0 = T0 + 0.5 * (alpha - gamma) / denominator;
    }
  }
  
  return sampleRate / T0;
}

// Tuner frame loop
function runTunerLoop() {
  if (!isListening) return;
  
  requestAnimationFrame(runTunerLoop);
  
  const timeDomainBuffer = new Float32Array(analyser.fftSize);
  if (typeof analyser.getFloat32TimeDomainData === 'function') {
    analyser.getFloat32TimeDomainData(timeDomainBuffer);
  } else {
    const byteBuffer = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(byteBuffer);
    for (let i = 0; i < byteBuffer.length; i++) {
      timeDomainBuffer[i] = (byteBuffer[i] - 128) / 128.0;
    }
  }
  
  const sampleRate = audioContext.sampleRate;
  let frequency = autoCorrelate(timeDomainBuffer, sampleRate);
  
  // Handle signal state & smoothing
  if (frequency !== -1 && frequency > 30 && frequency < 1000) {
    consecutiveSilentFrames = 0;
    lastFrequency = frequency;
  } else {
    consecutiveSilentFrames++;
    if (consecutiveSilentFrames < MAX_SILENT_FRAMES && lastFrequency !== -1) {
      // Re-use last valid frequency to keep gauge stable
      frequency = lastFrequency;
    } else {
      // Completely silent/inactive state
      frequency = -1;
      lastFrequency = -1;
    }
  }
  
  const inst = INSTRUMENTS[activeInstrument];
  
  if (frequency !== -1) {
    // 1. Determine active string
    if (autoDetectString) {
      selectedStringIndex = getClosestString(frequency, inst.strings);
    }
    
    // Keep visual tracker active
    if (selectedStringIndex !== lastStringIndex) {
      lastStringIndex = selectedStringIndex;
      updateStringVisuals();
    }
    
    const targetString = inst.strings[selectedStringIndex];
    
    // 2. Calculate cents deviation
    const cents = 1200 * Math.log2(frequency / targetString.freq);
    
    // 3. UI updates
    noteLetterDisp.textContent = targetString.note.slice(0, -1);
    
    // Rotate needle (map -50..+50 cents to -60..+60 degrees)
    const clampedCents = Math.max(-50, Math.min(50, cents));
    const needleAngle = (clampedCents / 50) * 60;
    needleGroup.style.transform = `rotate(${needleAngle}deg)`;
    
    // Theme accent update depending on pitch accuracy
    let accentColor = 'var(--color-default)';
    let glowColor = 'rgba(112, 126, 148, 0.3)';
    
    tuningCentsVal.className = 'meta-value';
    tuningStatusVal.className = 'meta-value';
    
    if (Math.abs(cents) <= 2.5) {
      tuningCentsVal.textContent = 'In Tune';
      tuningStatusVal.textContent = 'Perfect';
      tuningCentsVal.classList.add('status-in-tune');
      tuningStatusVal.classList.add('status-in-tune');
      accentColor = 'var(--color-in-tune)';
      glowColor = 'rgba(0, 240, 151, 0.4)';
    } else if (cents < -2.5) {
      tuningCentsVal.textContent = `${Math.abs(cents).toFixed(0)}¢ Flat`;
      tuningStatusVal.textContent = 'Tune Up';
      tuningCentsVal.classList.add('status-flat');
      tuningStatusVal.classList.add('status-flat');
      accentColor = 'var(--color-flat)';
      glowColor = 'rgba(0, 210, 255, 0.4)';
    } else {
      tuningCentsVal.textContent = `${cents.toFixed(0)}¢ Sharp`;
      tuningStatusVal.textContent = 'Tune Down';
      tuningCentsVal.classList.add('status-sharp');
      tuningStatusVal.classList.add('status-sharp');
      accentColor = 'var(--color-sharp)';
      glowColor = 'rgba(255, 42, 95, 0.4)';
    }
    
    document.documentElement.style.setProperty('--current-accent', accentColor);
    document.documentElement.style.setProperty('--current-glow', glowColor);
    
  } else {
    // Silent State Visual Resets
    needleGroup.style.transform = 'rotate(0deg)';
    tuningCentsVal.textContent = '--';
    tuningStatusVal.textContent = 'Listening...';
    
    tuningCentsVal.className = 'meta-value';
    tuningStatusVal.className = 'meta-value';
    
    document.documentElement.style.setProperty('--current-accent', 'var(--color-default)');
    document.documentElement.style.setProperty('--current-glow', 'rgba(112, 126, 148, 0.3)');
    
    if (autoDetectString) {
      noteLetterDisp.textContent = '--';
      
      if (lastStringIndex !== -1) {
        lastStringIndex = -1;
        updateStringVisuals();
      }
    }
  }
}

// Waveform visualizer loop
function drawWaveform() {
  requestAnimationFrame(drawWaveform);
  
  canvasCtx.fillStyle = 'rgba(10, 13, 20, 0.25)';
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
  
  canvasCtx.lineWidth = 2.5;
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--current-accent').trim() || '#707e94';
  canvasCtx.strokeStyle = accentColor;
  
  // Visual neon glow line
  canvasCtx.shadowBlur = 8;
  canvasCtx.shadowColor = accentColor;
  
  canvasCtx.beginPath();
  
  if (isListening && analyser && dataArray) {
    analyser.getByteTimeDomainData(dataArray);
    const sliceWidth = canvas.width / bufferLength;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      
      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }
      x += sliceWidth;
    }
  } else {
    // Draw flat line with tiny ambient vibration
    canvasCtx.moveTo(0, canvas.height / 2);
    const time = Date.now() * 0.004;
    for (let x = 0; x < canvas.width; x++) {
      const y = canvas.height / 2 + Math.sin(x * 0.05 + time) * 0.5;
      canvasCtx.lineTo(x, y);
    }
  }
  
  canvasCtx.stroke();
  canvasCtx.shadowBlur = 0; // reset glow for performance
}

// Render fretboard and start visualizer loop immediately
renderFretboard();
drawWaveform();
