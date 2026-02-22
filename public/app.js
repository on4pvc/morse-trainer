/* ==========================================
   MORSE TRAINER PRO - CLIENT APPLICATION
   Multi-user version with Socket.IO
   ========================================== */

// ==========================================
// SOCKET CONNECTION
// ==========================================
let socket;
let userId = null;
let isConnected = false;

function initSocket() {
    // Connect to server
    socket = io({
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
    });

    // Connection events
    socket.on('connect', () => {
        console.log('Connected to server');
        isConnected = true;
        updateConnectionStatus('connected', 'Connecté');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        isConnected = false;
        updateConnectionStatus('disconnected', 'Déconnecté');
    });

    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        updateConnectionStatus('disconnected', 'Erreur connexion');
    });

    // User initialization
    socket.on('user:init', (data) => {
        userId = data.odId;
        userCallsign = data.callsign;
        
        document.getElementById('callsignInput').value = userCallsign;
        document.getElementById('myCallsignBadge').textContent = userCallsign;
        document.getElementById('connIdText').textContent = userId.substring(0, 8) + '...';
        document.getElementById('connStatusText').textContent = 'Connecté';
        
        // Update channels
        updateChannelsFromServer(data.channels);
    });

    // Channel events
    socket.on('channels:update', (channels) => {
        updateChannelsFromServer(channels);
    });

    socket.on('channel:history', (data) => {
        // Load messages from server
        serverMessages = data.messages;
        loadChatMessagesFromServer();
        updateChannelUsersDisplay(data.users);
    });

    socket.on('channel:created', (data) => {
        console.log('Channel created:', data);
    });

    socket.on('channel:deleted', (data) => {
        if (currentChannel === data.channelId) {
            currentChannel = 'lobby';
            socket.emit('channel:join', 'lobby');
            updateChannelView();
        }
    });

    // User events
    socket.on('user:joined', (data) => {
        showNotification(`${data.callsign} a rejoint le channel`);
    });

    socket.on('user:left', (data) => {
        // Remove typing indicator if exists
        removeOtherTyping(data.odId visure);
    });

    socket.on('user:callsignChanged', (data) => {
        showNotification(`${data.oldCallsign} → ${data.newCallsign}`);
    });

    // Morse events from others
    socket.on('morse:typing', (data) => {
        if (data.odId !== userId) {
            updateOtherTyping(data.odId, data.callsign, data.currentMorse, data.currentText);
        }
    });

    socket.on('morse:element', (data) => {
        if (data.odId !== userId && playOthersAudio) {
            // Play the morse element from other user
            playOtherUserTone(data.element === '.' ? getTimings().dit : getTimings().dah);
        }
    });

    socket.on('morse:letter', (data) => {
        if (data.odId !== userId) {
            updateOtherTypingLetter(data.odId, data.callsign, data.letter);
        }
    });

    socket.on('morse:message', (data) => {
        if (data.odId !== userId) {
            addMessageFromServer(data);
            removeOtherTyping(data.odId);
        }
    });

    socket.on('morse:stopTyping', (data) => {
        removeOtherTyping(data.odId);
    });

    // Errors
    socket.on('error', (data) => {
        alert(data.message);
    });
}

function updateConnectionStatus(status, text) {
    const el = document.getElementById('connectionStatus');
    el.className = 'connection-status ' + status;
    el.querySelector('.status-text').textContent = text;
}

// ==========================================
// MORSE CODE DICTIONARY
// ==========================================
const morseCode = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 
    'F': '..-.', 'G': '--.', 'H': '....', 'I': '..', 'J': '.---',
    'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---',
    'P': '.--.', 'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-',
    'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-', 'Y': '-.--',
    'Z': '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--',
    '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
    '9': '----.', '/': '-..-.', '?': '..--..', '.': '.-.-.-', ',': '--..--'
};

const reverseMorse = Object.fromEntries(
    Object.entries(morseCode).map(([k, v]) => [v, k])
);

// ==========================================
// CONFIGURATION
// ==========================================
let keyMode = 'iambicA';
let invertPaddles = false;
let newlineDelay = 4000;
let showMorseInChat = true;
let playOthersAudio = true;
let userCallsign = '';

const modeDescriptions = {
    iambicA: 'Gauche=• | Droit=— | Squeeze=alt',
    iambicB: 'Comme A + opposé au relâchement',
    straight: 'Court=• | Long=—'
};

let serverChannels = [];
let serverMessages = [];
let otherUsersTyping = new Map();

// ==========================================
// CHANNELS FROM SERVER
// ==========================================
function updateChannelsFromServer(channels) {
    serverChannels = channels;
    renderChannels();
    updateOnlineUsersList();
}

function updateOnlineUsersList() {
    const list = document.getElementById('onlineUsersList');
    if (!list) return;
    
    const allUsers = new Set();
    serverChannels.forEach(ch => {
        if (ch.users) {
            ch.users.forEach(u => allUsers.add(u.callsign));
        }
    });
    
    list.innerHTML = Array.from(allUsers).map(callsign => 
        `<span class="online-user ${callsign === userCallsign ? 'me' : ''}">${callsign}</span>`
    ).join('');
}

function updateChannelUsersDisplay(users) {
    const list = document.getElementById('channelUsersList');
    const badge = document.getElementById('usersBadge');
    
    if (list) {
        list.innerHTML = users.map(u => 
            `<span class="user-tag ${u.callsign === userCallsign ? 'me' : ''}">${u.callsign}</span>`
        ).join('');
    }
    
    if (badge) {
        badge.textContent = `👤 ${users.length}`;
        badge.title = users.map(u => u.callsign).join(', ');
    }
}

// ==========================================
// OTHER USERS TYPING
// ==========================================
function updateOtherTyping(odId, callsign, morse, text) {
    otherUsersTyping.set(odId, { callsign, morse, text });
    renderOthersTyping();
}

function updateOtherTypingLetter(odId, callsign, letter) {
    const data = otherUsersTyping.get(odId) || { callsign, morse: '', text: '' };
    data.text += letter;
    data.morse = '';
    otherUsersTyping.set(odId, data);
    renderOthersTyping();
}

function removeOtherTyping(odId) {
    otherUsersTyping.delete(odId);
    renderOthersTyping();
}

function renderOthersTyping() {
    const container = document.getElementById('othersTyping');
    if (!container) return;
    
    if (otherUsersTyping.size === 0) {
        container.innerHTML = '';
        return;
    }
    
    let html = '';
    otherUsersTyping.forEach((data, odId) => {
        const morseDisplay = data.morse.replace(/\./g, '•').replace(/-/g, '—');
        html += `
            <div class="other-typing">
                <span class="callsign">${data.callsign}:</span>
                <span class="typing-text">${data.text}</span>
                <span class="typing-morse">${morseDisplay}</span>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// ==========================================
// AUDIO
// ==========================================
let audioContext = null;

function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') audioContext.resume();
}

function playToneForDuration(duration, isOther = false) {
    if (!canTransmit() && !isOther) return Promise.resolve();
    initAudio();
    
    return new Promise(resolve => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        
        osc.connect(gain);
        gain.connect(audioContext.destination);
        
        // Different frequency for other users
        const baseFreq = parseInt(document.getElementById('toneSlider').value);
        osc.frequency.value = isOther ? baseFreq + 100 : baseFreq;
        osc.type = 'sine';
        
        const vol = (parseInt(document.getElementById('volumeSlider').value) / 100) * (isOther ? 0.5 : 1);
        const now = audioContext.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(vol, now + 0.005);
        gain.gain.setValueAtTime(vol, now + duration / 1000 - 0.005);
        gain.gain.linearRampToValueAtTime(0, now + duration / 1000);
        
        osc.start(now);
        osc.stop(now + duration / 1000);
        osc.onended = resolve;
    });
}

function playOtherUserTone(duration) {
    if (!playOthersAudio) return;
    playToneForDuration(duration, true);
}

// ==========================================
// TIMING
// ==========================================
function getTimings() {
    const wpm = parseInt(document.getElementById('wpmSlider').value);
    const unit = 1200 / wpm;
    return {
        dit: unit,
        dah: unit * 3,
        intraChar: unit,
        interChar: unit * 3,
        interWord: unit * 7
    };
}

function updateTimingDisplay() {
    const wpm = document.getElementById('wpmSlider').value;
    const t = getTimings();
    document.getElementById('timingWpm').textContent = wpm;
    document.getElementById('timingDit').textContent = Math.round(t.dit);
    document.getElementById('timingDah').textContent = Math.round(t.dah);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function playMorseString(text) {
    const t = getTimings();
    for (let i = 0; i < text.length; i++) {
        const char = text[i].toUpperCase();
        if (char === ' ') {
            await sleep(t.interWord);
        } else if (morseCode[char]) {
            const morse = morseCode[char];
            for (let j = 0; j < morse.length; j++) {
                await playToneForDuration(morse[j] === '.' ? t.dit : t.dah);
                if (j < morse.length - 1) await sleep(t.intraChar);
            }
            if (i < text.length - 1 && text[i + 1] !== ' ') await sleep(t.interChar);
        }
    }
}

// ==========================================
// STATE
// ==========================================
let currentChannel = 'lobby';
let currentText = '';
let isTraining = false;
let stats = { score: 0, correct: 0, errors: 0 };

// Practice state
let practiceCurrentMorse = '';
let practiceDecodedText = '';
let practiceLetterTimer = null;

// Chat state
let chatCurrentMorse = '';
let chatCurrentText = '';
let chatCurrentMorseSequence = [];
let chatLetterTimer = null;
let chatWordTimer = null;
let chatNewlineTimer = null;
let chatComposingMessageId = null;

// Keyer state
let ditKeyDown = false;
let dahKeyDown = false;
let isKeyerBusy = false;
let keyerQueue = [];
let lastElement = null;
let keyerShouldStop = false;

// Straight key state
let straightKeyDown = false;
let straightKeyStart = 0;
let straightToneOscillator = null;

// ==========================================
// CALLSIGN
// ==========================================
function saveCallsign() {
    const input = document.getElementById('callsignInput');
    let newCallsign = input.value.trim().toUpperCase();
    
    if (newCallsign.length === 0) return;
    
    userCallsign = newCallsign.substring(0, 10);
    input.value = userCallsign;
    document.getElementById('myCallsignBadge').textContent = userCallsign;
    
    localStorage.setItem('morseCallsign', userCallsign);
    
    if (socket && isConnected) {
        socket.emit('user:updateCallsign', userCallsign);
    }
}

function updateShowMorse() {
    showMorseInChat = document.getElementById('showMorseCheckbox').checked;
    localStorage.setItem('morseShowMorseInChat', showMorseInChat);
    loadChatMessagesFromServer();
}

function updatePlayOthersAudio() {
    playOthersAudio = document.getElementById('playOthersAudioCheckbox').checked;
    localStorage.setItem('morsePlayOthersAudio', playOthersAudio);
}

// ==========================================
// CHANNELS
// ==========================================
function createPrivateChannel() {
    const input = document.getElementById('newChannelName');
    const name = input.value.trim();
    
    if (!name || !socket || !isConnected) return;
    
    socket.emit('channel:create', name);
    input.value = '';
}

function deletePrivateChannel(channelId) {
    if (!confirm('Supprimer ce channel ?')) return;
    if (socket && isConnected) {
        socket.emit('channel:delete', channelId);
    }
}

function renderChannels() {
    const container = document.getElementById('channelsList');
    let html = '';
    
    const baseChannels = serverChannels.filter(ch => !ch.isPrivate);
    const privateChannels = serverChannels.filter(ch => ch.isPrivate);
    
    baseChannels.forEach(ch => {
        const active = currentChannel === ch.id ? 'active' : '';
        const cssClass = ch.type === 'lobby' ? 'lobby' : ch.type === 'practice' ? 'practice' : '';
        const users = ch.users ? ch.users.map(u => u.callsign).join(', ') : '';
        
        html += `
            <div class="channel ${cssClass} ${active}" data-channel="${ch.id}">
                <div class="channel-header">
                    <span class="icon">${ch.icon}</span>
                    <span class="name">${ch.name}</span>
                    <span class="user-count">${ch.userCount || 0}</span>
                </div>
                ${users ? `<div class="channel-users">${users}</div>` : ''}
            </div>
        `;
    });
    
    if (privateChannels.length > 0) {
        html += '<h3>🔒 Privés</h3>';
        privateChannels.forEach(ch => {
            const active = currentChannel === ch.id ? 'active' : '';
            const users = ch.users ? ch.users.map(u => u.callsign).join(', ') : '';
            
            html += `
                <div class="channel private ${active}" data-channel="${ch.id}">
                    <div class="channel-header">
                        <span class="icon">${ch.icon}</span>
                        <span class="name">${ch.name}</span>
                        <span class="user-count">${ch.userCount || 0}</span>
                        <button class="delete-btn" onclick="event.stopPropagation(); deletePrivateChannel('${ch.id}')">✕</button>
                    </div>
                    ${users ? `<div class="channel-users">${users}</div>` : ''}
                </div>
            `;
        });
    }
    
    container.innerHTML = html;
    container.querySelectorAll('.channel').forEach(el => {
        el.addEventListener('click', () => switchToChannel(el.dataset.channel));
    });
}

function switchToChannel(channelId) {
    if (chatCurrentText.length > 0) {
        finalizeCurrentMessage();
    }
    
    stopTraining();
    keyerShouldStop = true;
    clearPracticeInput();
    resetChatState();
    otherUsersTyping.clear();
    renderOthersTyping();
    
    currentChannel = channelId;
    
    if (socket && isConnected) {
        socket.emit('channel:join', channelId);
    }
    
    renderChannels();
    updateChannelView();
}

// ==========================================
// CHAT FUNCTIONS
// ==========================================
function resetChatState() {
    chatCurrentMorse = '';
    chatCurrentText = '';
    chatCurrentMorseSequence = [];
    chatComposingMessageId = null;
    clearTimeout(chatLetterTimer);
    clearTimeout(chatWordTimer);
    clearTimeout(chatNewlineTimer);
    
    const morseDisplay = document.getElementById('currentMorseDisplay');
    const typingIndicator = document.getElementById('typingIndicator');
    if (morseDisplay) morseDisplay.textContent = '';
    if (typingIndicator) typingIndicator.textContent = 'En attente...';
}

function getOrCreateComposingMessage() {
    const chatZone = document.getElementById('chatZone');
    
    if (!chatComposingMessageId) {
        chatComposingMessageId = 'composing_' + Date.now();
        document.getElementById('chatEmpty').style.display = 'none';
        
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message composing';
        msgDiv.id = chatComposingMessageId;
        msgDiv.innerHTML = `
            <div class="callsign">${userCallsign}</div>
            <div class="morse"></div>
            <div class="text"><span class="cursor"></span></div>
        `;
        
        chatZone.appendChild(msgDiv);
        chatZone.scrollTop = chatZone.scrollHeight;
    }
    
    return document.getElementById(chatComposingMessageId);
}

function updateComposingMessage() {
    const msgDiv = getOrCreateComposingMessage();
    if (!msgDiv) return;
    
    const morseDisplay = chatCurrentMorseSequence.join(' ').replace(/\./g, '•').replace(/-/g, '—');
    const currentLetterDisplay = chatCurrentMorse.replace(/\./g, '•').replace(/-/g, '—');
    
    const morseEl = msgDiv.querySelector('.morse');
    if (showMorseInChat) {
        morseEl.textContent = morseDisplay + (currentLetterDisplay ? ' ' + currentLetterDisplay : '');
        morseEl.style.display = 'block';
    } else {
        morseEl.style.display = 'none';
    }
    
    msgDiv.querySelector('.text').innerHTML = chatCurrentText + '<span class="cursor"></span>';
    document.getElementById('chatZone').scrollTop = document.getElementById('chatZone').scrollHeight;
    
    // Send typing event to server
    if (socket && isConnected) {
        socket.emit('morse:typing', {
            currentMorse: chatCurrentMorse,
            currentText: chatCurrentText
        });
    }
}

function startNewlineTimer() {
    clearTimeout(chatNewlineTimer);
    chatNewlineTimer = setTimeout(() => {
        if (chatCurrentText.length > 0) finalizeCurrentMessage();
    }, newlineDelay);
}

function finalizeCurrentMessage() {
    clearTimeout(chatNewlineTimer);
    
    const msgDiv = document.getElementById(chatComposingMessageId);
    
    if (chatCurrentText.trim().length > 0) {
        const morseDisplay = chatCurrentMorseSequence.join(' ').replace(/\./g, '•').replace(/-/g, '—');
        
        // Send to server
        if (socket && isConnected) {
            socket.emit('morse:message', {
                text: chatCurrentText.trim(),
                morse: morseDisplay
            });
        }
        
        // Update local display
        if (msgDiv) {
            msgDiv.className = 'chat-message';
            msgDiv.innerHTML = `
                <div class="callsign">${userCallsign}</div>
                ${showMorseInChat ? `<div class="morse">${morseDisplay}</div>` : ''}
                <div class="text slashed-zero">${chatCurrentText.trim()}</div>
                <div class="timestamp">${new Date().toLocaleTimeString()}</div>
            `;
        }
    } else if (msgDiv) {
        msgDiv.remove();
    }
    
    // Notify server that we stopped typing
    if (socket && isConnected) {
        socket.emit('morse:stopTyping');
    }
    
    chatCurrentMorse = '';
    chatCurrentText = '';
    chatCurrentMorseSequence = [];
    chatComposingMessageId = null;
    
    document.getElementById('currentMorseDisplay').textContent = '';
    document.getElementById('typingIndicator').textContent = 'En attente...';
}

function addMessageFromServer(data) {
    const chatZone = document.getElementById('chatZone');
    document.getElementById('chatEmpty').style.display = 'none';
    
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message from-other';
    msgDiv.innerHTML = `
        <div class="callsign">${data.callsign}</div>
        ${showMorseInChat ? `<div class="morse">${data.morse}</div>` : ''}
        <div class="text slashed-zero">${data.text}</div>
        <div class="timestamp">${data.time}</div>
    `;
    
    chatZone.appendChild(msgDiv);
    chatZone.scrollTop = chatZone.scrollHeight;
}

function loadChatMessagesFromServer() {
    const chatZone = document.getElementById('chatZone');
    
    // Clear existing messages
    chatZone.querySelectorAll('.chat-message').forEach(m => m.remove());
    
    if (serverMessages.length === 0) {
        document.getElementById('chatEmpty').style.display = 'block';
    } else {
        document.getElementById('chatEmpty').style.display = 'none';
        serverMessages.forEach(msg => {
            const isMe = msg.odId === odisocket.id || msg.callsign === userCallsign;
            const msgDiv = document.createElement('div');
            msgDiv.className = `chat-message ${isMe ? '' : 'from-other'}`;
            msgDiv.innerHTML = `
                <div class="callsign">${msg.callsign}</div>
                ${showMorseInChat ? `<div class="morse">${msg.morse}</div>` : ''}
                <div class="text slashed-zero">${msg.text}</div>
                <div class="timestamp">${msg.time}</div>
            `;
            chatZone.appendChild(msgDiv);
        });
    }
    
    chatZone.scrollTop = chatZone.scrollHeight;
}

function addChatElement(element) {
    chatCurrentMorse += element;
    
    const display = chatCurrentMorse.replace(/\./g, '•').replace(/-/g, '—');
    document.getElementById('currentMorseDisplay').textContent = display;
    document.getElementById('typingIndicator').textContent = 'Saisie: ' + display;
    
    updateComposingMessage();
    startNewlineTimer();
    
    // Send element to server for audio sync
    if (socket && isConnected) {
        socket.emit('morse:element', {
            element: element,
            duration: element === '.' ? getTimings().dit : getTimings().dah
        });
    }
}

function finalizeChatLetter() {
    if (chatCurrentMorse.length > 0) {
        const char = reverseMorse[chatCurrentMorse] || '?';
        chatCurrentText += char;
        chatCurrentMorseSequence.push(chatCurrentMorse);
        
        // Send letter to server
        if (socket && isConnected) {
            socket.emit('morse:letter', {
                letter: char,
                morse: chatCurrentMorse
            });
        }
        
        chatCurrentMorse = '';
        
        document.getElementById('currentMorseDisplay').textContent = '';
        document.getElementById('typingIndicator').textContent = 'Lettre: ' + char;
        
        updateComposingMessage();
        startNewlineTimer();
    }
}

function addChatWordSpace() {
    if (chatCurrentText.length > 0 && !chatCurrentText.endsWith(' ')) {
        chatCurrentText += ' ';
        chatCurrentMorseSequence.push('/');
        document.getElementById('typingIndicator').textContent = 'Espace';
        updateComposingMessage();
    }
}

// ==========================================
// KEYER
// ==========================================
function getElementForKey(key) {
    if (keyMode === 'straight') return null;
    if (invertPaddles) return key === 'dit' ? '-' : '.';
    return key === 'dit' ? '.' : '-';
}

async function runKeyer() {
    if (isKeyerBusy) return;
    isKeyerBusy = true;
    keyerShouldStop = false;
    
    const t = getTimings();
    
    while (!keyerShouldStop) {
        let element = null;
        
        if (keyerQueue.length > 0) {
            element = keyerQueue.shift();
        } else if (ditKeyDown && dahKeyDown) {
            element = (lastElement === '.') ? '-' : '.';
        } else if (ditKeyDown) {
            element = getElementForKey('dit');
        } else if (dahKeyDown) {
            element = getElementForKey('dah');
        } else {
            break;
        }
        
        if (!element) break;
        
        lastElement = element;
        await playToneForDuration(element === '.' ? t.dit : t.dah);
        addElementToMorse(element);
        await sleep(t.intraChar);
        
        if (!ditKeyDown && !dahKeyDown && keyerQueue.length === 0) break;
    }
    
    isKeyerBusy = false;
    if (!ditKeyDown && !dahKeyDown) startLetterTimer();
}

function handleIambicKeyDown(key) {
    if (key === 'dit') { ditKeyDown = true; highlightKey('leftKey', true); }
    else { dahKeyDown = true; highlightKey('rightKey', true); }
    
    if (ditKeyDown && dahKeyDown) highlightBothKeys(true);
    
    clearTimeout(practiceLetterTimer);
    clearTimeout(chatLetterTimer);
    clearTimeout(chatWordTimer);
    
    if (!isKeyerBusy) runKeyer();
}

function handleIambicKeyUp(key) {
    const wasSqueezing = ditKeyDown && dahKeyDown;
    
    if (key === 'dit') { ditKeyDown = false; highlightKey('leftKey', false); }
    else { dahKeyDown = false; highlightKey('rightKey', false); }
    
    highlightBothKeys(false);
    
    if (keyMode === 'iambicB' && wasSqueezing && isKeyerBusy) {
        keyerQueue.push((lastElement === '.') ? '-' : '.');
    }
}

function handleStraightKeyDown() {
    if (straightKeyDown) return;
    straightKeyDown = true;
    straightKeyStart = Date.now();
    
    clearTimeout(practiceLetterTimer);
    clearTimeout(chatLetterTimer);
    clearTimeout(chatWordTimer);
    
    initAudio();
    straightToneOscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    
    straightToneOscillator.connect(gain);
    gain.connect(audioContext.destination);
    straightToneOscillator.frequency.value = parseInt(document.getElementById('toneSlider').value);
    gain.gain.value = parseInt(document.getElementById('volumeSlider').value) / 100;
    
    straightToneOscillator.start();
    highlightKey('straightKey', true);
}

function handleStraightKeyUp() {
    if (!straightKeyDown) return;
    straightKeyDown = false;
    
    if (straightToneOscillator) {
        straightToneOscillator.stop();
        straightToneOscillator = null;
    }
    
    highlightKey('straightKey', false);
    
    const duration = Date.now() - straightKeyStart;
    const t = getTimings();
    addElementToMorse(duration < (t.dit + t.dah) / 2 ? '.' : '-');
    startLetterTimer();
}

// ==========================================
// MORSE INPUT
// ==========================================
function addElementToMorse(element) {
    const type = getChannelType();
    if (type === 'practice') {
        practiceCurrentMorse += element;
        updatePracticeDisplay();
    } else if (type === 'chat') {
        addChatElement(element);
    }
}

function startLetterTimer() {
    const t = getTimings();
    const type = getChannelType();
    
    if (type === 'practice') {
        clearTimeout(practiceLetterTimer);
        practiceLetterTimer = setTimeout(finalizePracticeLetter, t.interChar);
    } else if (type === 'chat') {
        clearTimeout(chatLetterTimer);
        chatLetterTimer = setTimeout(finalizeChatLetter, t.interChar);
        clearTimeout(chatWordTimer);
        chatWordTimer = setTimeout(addChatWordSpace, t.interWord);
    }
}

function finalizePracticeLetter() {
    if (practiceCurrentMorse.length > 0) {
        const char = reverseMorse[practiceCurrentMorse] || '?';
        practiceDecodedText += char;
        practiceCurrentMorse = '';
        updatePracticeDisplay();
        checkPracticeAnswer();
    }
}

// ==========================================
// DISPLAY
// ==========================================
function updatePracticeDisplay() {
    document.getElementById('practiceUserMorse').textContent = 
        practiceCurrentMorse.replace(/\./g, '•').replace(/-/g, '—');
    document.getElementById('practiceUserDecoded').textContent = practiceDecodedText;
}

function highlightKey(keyId, active) {
    document.querySelectorAll(`#${keyId}`).forEach(key => {
        key.classList.toggle('active', active);
    });
}

function highlightBothKeys(active) {
    ['leftKey', 'rightKey'].forEach(id => {
        document.querySelectorAll(`#${id}`).forEach(key => {
            key.classList.toggle('both-active', active);
        });
    });
}

function showNotification(message) {
    console.log('Notification:', message);
    // Could add visual notification here
}

// ==========================================
// KEYBOARD EVENTS
// ==========================================
document.addEventListener('keydown', (e) => {
    if (!canTransmit() || e.repeat) return;
    
    if (keyMode === 'straight') {
        if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
            e.preventDefault();
            handleStraightKeyDown();
        }
    } else {
        if (e.code === 'ControlLeft') { e.preventDefault(); handleIambicKeyDown('dit'); }
        else if (e.code === 'ControlRight') { e.preventDefault(); handleIambicKeyDown('dah'); }
    }
});

document.addEventListener('keyup', (e) => {
    if (!canTransmit()) return;
    
    if (keyMode === 'straight') {
        if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
            e.preventDefault();
            handleStraightKeyUp();
        }
    } else {
        if (e.code === 'ControlLeft') { e.preventDefault(); handleIambicKeyUp('dit'); }
        else if (e.code === 'ControlRight') { e.preventDefault(); handleIambicKeyUp('dah'); }
    }
});

window.addEventListener('blur', () => {
    ditKeyDown = false;
    dahKeyDown = false;
    straightKeyDown = false;
    keyerShouldStop = true;
    keyerQueue = [];
    
    if (straightToneOscillator) {
        straightToneOscillator.stop();
        straightToneOscillator = null;
    }
    
    highlightKey('leftKey', false);
    highlightKey('rightKey', false);
    highlightKey('straightKey', false);
    highlightBothKeys(false);
});

// ==========================================
// UTILITY
// ==========================================
function canTransmit() {
    const ch = serverChannels.find(c => c.id === currentChannel);
    return ch && ch.type !== 'lobby';
}

function getChannelType() {
    const ch = serverChannels.find(c => c.id === currentChannel);
    return ch ? ch.type : 'lobby';
}

// ==========================================
// PRACTICE
// ==========================================
function clearPracticeInput() {
    practiceCurrentMorse = '';
    practiceDecodedText = '';
    clearTimeout(practiceLetterTimer);
    updatePracticeDisplay();
}

function checkPracticeAnswer() {
    if (practiceDecodedText.length >= currentText.length) {
        if (practiceDecodedText === currentText) {
            stats.correct++;
            stats.score += 10;
        } else {
            stats.errors++;
        }
        updateStats();
        if (isTraining) setTimeout(playNext, 1500);
    }
}

function generatePracticeContent() {
    const types = ['letter', 'number', 'word', 'callsign'];
    const type = types[Math.floor(Math.random() * types.length)];
    
    switch(type) {
        case 'letter': return String.fromCharCode(65 + Math.floor(Math.random() * 26));
        case 'number': return String(Math.floor(Math.random() * 10));
        case 'word':
            const words = ['CQ', 'DE', 'QTH', 'QSL', 'RST', '73', 'GM'];
            return words[Math.floor(Math.random() * words.length)];
        case 'callsign':
            const pfx = ['K', 'W', 'N', 'F', 'G', 'ON'][Math.floor(Math.random() * 6)];
            return pfx + Math.floor(Math.random() * 10) + 
                   String.fromCharCode(65 + Math.floor(Math.random() * 26)) +
                   String.fromCharCode(65 + Math.floor(Math.random() * 26));
    }
}

function startTraining() { isTraining = true; playNext(); }
function stopTraining() { isTraining = false; }

async function playNext() {
    if (!isTraining) return;
    clearPracticeInput();
    currentText = generatePracticeContent();
    
    const morse = currentText.split('').map(c => morseCode[c] || '').join(' ');
    document.getElementById('morseCode').textContent = morse.replace(/\./g, '•').replace(/-/g, '—');
    document.getElementById('decodedText').textContent = currentText;
    
    await sleep(500);
    await playMorseString(currentText);
}

function repeatCurrent() { if (currentText) playMorseString(currentText); }

function updateStats() {
    document.getElementById('score').textContent = stats.score;
    document.getElementById('correct').textContent = stats.correct;
    document.getElementById('errors').textContent = stats.errors;
    const total = stats.correct + stats.errors;
    document.getElementById('accuracy').textContent = 
        (total > 0 ? ((stats.correct / total) * 100).toFixed(0) : 100) + '%';
}

// ==========================================
// SETTINGS
// ==========================================
function setKeyMode(mode) {
    keyMode = mode;
    localStorage.setItem('morseKeyMode', mode);
    
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`mode${mode.charAt(0).toUpperCase() + mode.slice(1)}Btn`).classList.add('active');
    
    document.getElementById('modeDescription').textContent = modeDescriptions[mode];
    document.getElementById('modeIndicator').textContent = 
        mode === 'straight' ? '🔑 P' : `🎹 ${mode.slice(-1).toUpperCase()}`;
    updateKeyIndicators();
    
    keyerShouldStop = true;
    keyerQueue = [];
    ditKeyDown = false;
    dahKeyDown = false;
}

function toggleInvert() {
    invertPaddles = !invertPaddles;
    localStorage.setItem('morseInvertPaddles', invertPaddles);
    
    document.getElementById('invertToggle').classList.toggle('active', invertPaddles);
    document.getElementById('invertIndicator').classList.toggle('active', invertPaddles);
    document.getElementById('invertDescription').textContent = invertPaddles ? 'Inversé' : 'Normal';
    
    updateKeyIndicators();
}

function updateKeyIndicators() {
    const practiceIndicator = document.getElementById('practiceKeyIndicator');
    const channelIndicator = document.getElementById('channelKeyIndicator');
    
    let html;
    if (keyMode === 'straight') {
        html = `<div class="key straight-key" id="straightKey">CTRL</div>`;
    } else {
        const left = invertPaddles ? '—' : '•';
        const right = invertPaddles ? '•' : '—';
        const cls = invertPaddles ? ' inverted' : '';
        html = `<div class="key${cls}" id="leftKey">◀ ${left}</div>
                <div class="key${cls}" id="rightKey">${right} ▶</div>`;
    }
    
    practiceIndicator.innerHTML = html;
    channelIndicator.innerHTML = html;
}

function updateChannelView() {
    const ch = serverChannels.find(c => c.id === currentChannel);
    if (!ch) return;
    
    document.getElementById('channelIndicator').textContent = `${ch.icon} ${ch.name}`;
    
    document.getElementById('lobbyView').classList.add('hidden');
    document.getElementById('practiceView').classList.add('hidden');
    document.getElementById('channelView').classList.add('hidden');
    
    switch(ch.type) {
        case 'lobby':
            document.getElementById('lobbyView').classList.remove('hidden');
            break;
        case 'practice':
            document.getElementById('practiceView').classList.remove('hidden');
            break;
        case 'chat':
            document.getElementById('channelView').classList.remove('hidden');
            break;
    }
    
    updateKeyIndicators();
}

function setTheme(theme) {
    document.body.className = theme;
    localStorage.setItem('morseTheme', theme);
    
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`theme${theme.charAt(0).toUpperCase() + theme.slice(1)}Btn`).classList.add('active');
}

function toggleSettings() {
    document.getElementById('settingsPanel').classList.toggle('active');
}

// ==========================================
// EVENT LISTENERS - SLIDERS
// ==========================================
document.getElementById('wpmSlider').addEventListener('input', function() {
    document.getElementById('wpmDisplay').textContent = this.value;
    updateTimingDisplay();
});

document.getElementById('toneSlider').addEventListener('input', function() {
    document.getElementById('toneDisplay').textContent = this.value;
});

document.getElementById('volumeSlider').addEventListener('input', function() {
    document.getElementById('volumeDisplay').textContent = this.value;
});

document.getElementById('newlineDelaySlider').addEventListener('input', function() {
    document.getElementById('newlineDelayDisplay').textContent = this.value;
    document.getElementById('pauseDelayDisplay').textContent = this.value;
    newlineDelay = this.value * 1000;
    localStorage.setItem('morseNewlineDelay', this.value);
});

document.getElementById('newChannelName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') createPrivateChannel();
});

document.getElementById('callsignInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') saveCallsign();
});

// ==========================================
// INITIALIZATION
// ==========================================
window.addEventListener('load', () => {
    // Load settings from localStorage
    const savedTheme = localStorage.getItem('morseTheme') || 'light';
    const savedMode = localStorage.getItem('morseKeyMode') || 'iambicA';
    const savedInvert = localStorage.getItem('morseInvertPaddles') === 'true';
    const savedDelay = localStorage.getItem('morseNewlineDelay') || '4';
    const savedShowMorse = localStorage.getItem('morseShowMorseInChat');
    const savedPlayOthers = localStorage.getItem('morsePlayOthersAudio');
    const savedCallsign = localStorage.getItem('morseCallsign');
    
    // Apply settings
    setTheme(savedTheme);
    setKeyMode(savedMode);
    if (savedInvert) toggleInvert();
    
    // Newline delay
    document.getElementById('newlineDelaySlider').value = savedDelay;
    document.getElementById('newlineDelayDisplay').textContent = savedDelay;
    document.getElementById('pauseDelayDisplay').textContent = savedDelay;
    newlineDelay = parseInt(savedDelay) * 1000;
    
    // Show morse
    if (savedShowMorse !== null) showMorseInChat = savedShowMorse === 'true';
    document.getElementById('showMorseCheckbox').checked = showMorseInChat;
    
    // Play others audio
    if (savedPlayOthers !== null) playOthersAudio = savedPlayOthers === 'true';
    document.getElementById('playOthersAudioCheckbox').checked = playOthersAudio;
    
    // Saved callsign (will be overwritten by server)
    if (savedCallsign) {
        document.getElementById('callsignInput').value = savedCallsign;
    }
    
    updateTimingDisplay();
    
    // Initialize socket connection
    initSocket();
});
