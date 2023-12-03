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

let dataChannel = null;

// Functions
async function getPeerConnectionStats() {
  const statsReport = await peerConn.getStats();
  let frameRateValue = '-';
  let jitterValue = '-';

  statsReport.forEach(report => {
    if (report.type === 'inbound-rtp' && report.kind === 'video') {
      frameRateValue = report.framesPerSecond;
      jitterValue = report.jitter;
    }
  });

  document.getElementById('frameRate').innerText = `Frame Rate: ${frameRateValue}`;
  document.getElementById('jitter').innerText = `Jitter: ${jitterValue}`;
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
  callIdField.hidden = false;

  setInterval(getPeerConnectionStats, 5);
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
}

// Function to Answer Call by ID
async function answerCallById() {
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
}

// Event Listeners
startWebcamBtn.onclick = enableWebcam;
sendMessageBtn.onclick = handleSendMessage;
initiateCallBtn.onclick = createCallOffer;
answerCallBtn.onclick = answerCallById;