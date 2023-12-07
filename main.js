import './style.css';

import firebaseApp from 'firebase/app';
import 'firebase/firestore';

// Firebase Configuration
const firebaseSetup = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

if (!firebaseApp.apps.length) {
  firebaseApp.initializeApp(firebaseSetup);
}
const dbService = firebaseApp.firestore();

// WebRTC Configuration
const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
  ],
  iceCandidatePoolSize: 10
};

// Peer Connection
const peerConn = new RTCPeerConnection(rtcConfig);
let localVideoStream = null;
let remoteVideoStream = null;

// DOM Elements
const startWebcamBtn = document.getElementById('startWebcam');
const localVideoElement = document.getElementById('localVideo');
const initiateCallBtn = document.getElementById('initiateCall');
const callIdField = document.getElementById('callId');
const answerCallBtn = document.getElementById('answerCall');
const remoteVideoElement = document.getElementById('remoteVideo');

// Chat Elements
const chatMessageField = document.getElementById('chatMessage');
const sendMessageBtn = document.getElementById('sendMessage');

// Initialize Chart Variables
let chart;
let frameRateChart, bitrateChart, jitterChart;
let frameRates = [];
let bitrates = [];
let jitters = [];
let timestamps = [];
const MAX_DATA_POINTS = 15; // Number of data points to show on chart


let dataChannel = null;

let bytesPrev = 0;
let timestampPrev = Date.now();
let resolution = '-';
let bytesSentPrev = 0;

// Functions
async function getPeerConnectionStats() {
  const statsReport = await peerConn.getStats();
  let frameRateValue = 0;
  let jitterValue = 0;

  let bytes = 0;
  let timestamp = 0;

  let bytesSent = 0;

  statsReport.forEach(report => {
    if (report.type === 'inbound-rtp' && report.kind === 'video') {
      frameRateValue = report.framesPerSecond;
      jitterValue = report.jitter;
      resolution = `${report.frameWidth}x${report.frameHeight}`;
      bytes = report.bytesReceived;
    }

    if (report.type === 'outbound-rtp' && report.kind === 'video') {
      bytesSent = report.bytesSent;
    }
  });

  document.getElementById('frameRate').innerText = `Frame Rate: ${frameRateValue}`;
  document.getElementById('jitter').innerText = `Jitter: ${jitterValue}`;

  timestamp = Date.now();
  let bitrate = 8 * (bytes - bytesPrev) / (timestamp - timestampPrev);
  bytesPrev = bytes;

  adjustBitrateOnBytesSent(bytesSent - bytesSentPrev);
  bytesSentPrev = bytesSent;

  timestampPrev = timestamp;

  document.getElementById('bitrate').innerText = `Bitrate: ${bitrate.toFixed(2)}`;
  document.getElementById('resolution').innerText = `Resolution: ${resolution}`;

  // Add data to arrays
  frameRates.push(frameRateValue);
  bitrates.push(bitrate.toFixed(2));
  jitters.push(jitterValue);
  timestamps.push(new Date(timestamp).toLocaleTimeString());

  // Keep only the last N data points
  if (timestamps.length > MAX_DATA_POINTS) {
    frameRates.shift();
    bitrates.shift();
    jitters.shift();
    timestamps.shift();
  }

  updateCharts();
}

const INITIAL_BITRATE = 200000; // 200 kbps
const MAX_BITRATE = 2500000; // 2.5 Mbps
const MIN_BITRATE = 100000; // 100 kbps
const THRESHOLD = 10000; // 10 KB
const INCREMENT = 100000; // 50 kbps
// const SEVERE_DECREMENT = 300000; // 300 kbps

let lastBytesSent = 0;
let currentBitrate = INITIAL_BITRATE; 
const maxBitrate = MAX_BITRATE;
const minBitrate = MIN_BITRATE;

function adjustBitrateOnBytesSent(bytesSent) {
  const bytesDifference = bytesSent - lastBytesSent;
  const threshold = THRESHOLD; // Set a threshold for significant change

  if (bytesDifference > threshold) {
    // Increase bitrate
    currentBitrate = Math.min(currentBitrate + INCREMENT, maxBitrate);
  } else if (-bytesDifference > threshold) {
    // Severe penalty on decrease
    currentBitrate = Math.max(currentBitrate/2, minBitrate);
  }

  // Update the bitrate in WebRTC
  updateWebRTCBitrate(currentBitrate);

  lastBytesSent = bytesSent;
}

function updateWebRTCBitrate(newBitrate) {
  const sender = peerConn.getSenders().find(s => s.track.kind === 'video');
  if (sender) {
    const params = sender.getParameters();
    if (!params.encodings) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = newBitrate;
    sender.setParameters(params);
  }
}

function initializeCharts() {
  // Frame Rate - Line Chart
  const ctxFrameRate = document.getElementById('frameRateChart').getContext('2d');
  frameRateChart = new Chart(ctxFrameRate, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Frame Rate',
        data: [],
        borderColor: 'blue',
        borderWidth: 2
      }]
    },
    
  });

  // Bitrate - Bar Chart
  const ctxBitrate = document.getElementById('bitrateChart').getContext('2d');
  bitrateChart = new Chart(ctxBitrate, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Bitrate',
        data: [],
        backgroundColor: 'rgba(255, 99, 132, 0.5)',
        borderColor: 'rgba(255, 99, 132, 1)',
        borderWidth: 1
      }]
    },
    
  });

  // Jitter - Radar Chart
  const ctxJitter = document.getElementById('jitterChart').getContext('2d');
  jitterChart = new Chart(ctxJitter, {
    type: 'radar',
    data: {
      labels: [],
      datasets: [{
        label: 'Jitter',
        data: [],
        borderColor: 'green',
        backgroundColor: 'rgba(0, 255, 0, 0.2)',
        borderWidth: 2
      }]
    },
    options: {
      
    }
  });
}

function updateCharts() {
  updateChart(frameRateChart, frameRates);
  updateChart(bitrateChart, bitrates);
  updateChart(jitterChart, jitters);
}

function updateChart(chart, data) {
  if (chart) {
    chart.data.labels = timestamps;
    chart.data.datasets[0].data = data;
    chart.update();
  }
}

// Function to Enable Webcam
async function enableWebcam() {
  localVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  remoteVideoStream = new MediaStream();

  localVideoStream.getTracks().forEach(track => {
    peerConn.addTrack(track, localVideoStream);
  });

  peerConn.ontrack = event => {
    event.streams[0].getTracks().forEach(track => {
      remoteVideoStream.addTrack(track);
    });
  };

  dataChannel = peerConn.createDataChannel("chat");
  setupDataChannelEvents(dataChannel);

  localVideoElement.srcObject = localVideoStream;
  localVideoElement.muted = true;
  remoteVideoElement.srcObject = remoteVideoStream;

  initiateCallBtn.disabled = false;
  answerCallBtn.disabled = false;
  startWebcamBtn.disabled = true;
  startWebcamBtn.textContent = "Webcam Enabled";

  setInterval(getPeerConnectionStats, 2000);

}

// Function to Send Chat Message
async function handleSendMessage() {
  const message = chatMessageField.value;
  chatMessageField.value = '';

  if (dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(message);
  }
}

function setupDataChannelEvents(dataChannel) {
  dataChannel.onopen = event => {
    sendMessageBtn.disabled = false;
  };

  dataChannel.onmessage = event => {
    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.innerHTML += `<div>${event.data}</div>`; // Display received message
  };
}

peerConn.ondatachannel = event => {
  dataChannel = event.channel;
  setupDataChannelEvents(dataChannel);
};


// Function to Create Call Offer
async function createCallOffer() {
  const callDocument = dbService.collection('calls').doc();
  const offerCandidates = callDocument.collection('offerCandidates');
  const answerCandidates = callDocument.collection('answerCandidates');

  callIdField.value = callDocument.id;

  peerConn.onicecandidate = event => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  const offerDescription = await peerConn.createOffer();
  await peerConn.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDocument.set({ offer });

  callDocument.onSnapshot(snapshot => {
    const data = snapshot.data();
    if (!peerConn.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      peerConn.setRemoteDescription(answerDescription);
    }
  });

  answerCandidates.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        peerConn.addIceCandidate(candidate);
      }
    });
  });

  sendMessageBtn.disabled = false;
  answerCallBtn.disabled = true;
  answerCallBtn.hidden = true;
  callIdField.disabled = true;
  initiateCallBtn.textContent = "Here is your Call ID:";
  initiateCallBtn.disabled = true;
  chatMessageField.disabled = false;

  initializeCharts();
}

// Function to Answer Call by ID
async function answerCallById() {
  if (answerCallBtn.textContent === "Join Existing Call") {
    answerCallBtn.textContent = "Join with Call ID:";
    callIdField.disabled = false;
    callIdField.placeholder = "Enter Call ID";
    initiateCallBtn.hidden = true;
    return;
  }
  const callId = callIdField.value;
  const callDocument = dbService.collection('calls').doc(callId);

  // Check if the call document exists
  const docSnapshot = await callDocument.get();
  if (!docSnapshot.exists) {
      alert("Invalid call ID. Please enter a valid call ID.");
      return;
  }

  const answerCandidates = callDocument.collection('answerCandidates');
  const offerCandidates = callDocument.collection('offerCandidates');

  peerConn.onicecandidate = event => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDocument.get()).data();

  const offerDescription = callData.offer;
  await peerConn.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await peerConn.createAnswer();
  await peerConn.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDocument.update({ answer });

  offerCandidates.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const candidateData = change.doc.data();
        peerConn.addIceCandidate(new RTCIceCandidate(candidateData));
      }
    });
  });
  
  sendMessageBtn.disabled = false;
  answerCallBtn.disabled = true;
  callIdField.disabled = true;
  chatMessageField.disabled = false;

  initializeCharts();
}

// Event Listeners
startWebcamBtn.onclick = enableWebcam;
sendMessageBtn.onclick = handleSendMessage;
initiateCallBtn.onclick = createCallOffer;
answerCallBtn.onclick = answerCallById;