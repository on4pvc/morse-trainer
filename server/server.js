/* ==========================================
   MORSE TRAINER PRO - SERVER
   Real-time multi-user morse code training
   ========================================== */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuration
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';

// Socket.IO setup
const io = new Server(server, {
    cors: {
        origin: ALLOWED_ORIGINS === '*' ? '*' : ALLOWED_ORIGINS.split(','),
        methods: ['GET', 'POST']
    },
    pingTimeout: 60000,
    pingInterval: 25000
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ==========================================
// DATA STRUCTURES
// ==========================================

// Base channels (always available)
const baseChannels = [
    { id: 'lobby', name: 'Lobby', icon: '🏠', type: 'lobby' },
    { id: 'practice', name: 'Practice', icon: '🎯', type: 'practice' },
    { id: 'channel1', name: 'Channel 1', icon: '📡', type: 'chat' },
    { id: 'channel2', name: 'Channel 2', icon: '📡', type: 'chat' },
    { id: 'channel3', name: 'Channel 3', icon: '📡', type: 'chat' },
    { id: 'channel4', name: 'Channel 4', icon: '📡', type: 'chat' },
    { id: 'channel5', name: 'Channel 5', icon: '📡', type: 'chat' },
    { id: 'channel6', name: 'Channel 6', icon: '📡', type: 'chat' }
];

// Store for users and channels
const users = new Map(); // odisocket.id -> user data
const channels = new Map(); // channelId -> { users: Set, messages: [] }
const privateChannels = new Map(); // channelId -> channel data

// Initialize base channels
baseChannels.forEach(ch => {
    channels.set(ch.id, {
        ...ch,
        users: new Set(),
        messages: []
    });
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function generateCallsign() {
    const num = String(Math.floor(Math.random() * 900) + 100);
    return 'HAM-' + num;
}

function getChannelUsers(channelId) {
    const channel = channels.get(channelId) || privateChannels.get(channelId);
    if (!channel) return [];
    
    return Array.from(channel.users).map(socketId => {
        const user = users.get(socketId);
        return user ? { id: socketId, callsign: user.callsign } : null;
    }).filter(Boolean);
}

function getAllChannelsInfo() {
    const allChannels = [];
    
    // Base channels
    baseChannels.forEach(ch => {
        const channel = channels.get(ch.id);
        allChannels.push({
            ...ch,
            userCount: channel ? channel.users.size : 0,
            users: getChannelUsers(ch.id)
        });
    });
    
    // Private channels
    privateChannels.forEach((ch, id) => {
        allChannels.push({
            ...ch,
            id: id,
            userCount: ch.users.size,
            users: getChannelUsers(id),
            isPrivate: true
        });
    });
    
    return allChannels;
}

function broadcastChannelUpdate() {
    const channelsInfo = getAllChannelsInfo();
    io.emit('channels:update', channelsInfo);
}

function getChannelMessages(channelId, limit = 50) {
    const channel = channels.get(channelId) || privateChannels.get(channelId);
    if (!channel) return [];
    return channel.messages.slice(-limit);
}

// ==========================================
// SOCKET.IO EVENTS
// ==========================================

io.on('connection', (socket) => {
    console.log(`[${new Date().toISOString()}] User connected: ${socket.id}`);
    
    // Initialize user
    const user = {
        id visure: socket.id,
        callsign: generateCallsign(),
        currentChannel: 'lobby',
        isTyping: false
    };
    users.set(socket.id, user);
    
    // Join lobby by default
    socket.join('lobby');
    channels.get('lobby').users.add(socket.id);
    
    // Send initial data to user
    socket.emit('user:init', {
        userId: socket.id,
        callsign: user.callsign,
        channels: getAllChannelsInfo()
    });
    
    // Broadcast updated channels
    broadcastChannelUpdate();
    
    // ==========================================
    // USER EVENTS
    // ==========================================
    
    // Update callsign
    socket.on('user:updateCallsign', (newCallsign) => {
        const user = users.get(socket.id);
        if (user && newCallsign && newCallsign.trim().length > 0) {
            const oldCallsign = user.callsign;
            user.callsign = newCallsign.trim().toUpperCase().substring(0, 10);
            
            console.log(`[${new Date().toISOString()}] Callsign changed: ${oldCallsign} -> ${user.callsign}`);
            
            // Notify others in the same channel
            socket.to(user.currentChannel).emit('user:callsignChanged', {
                odId: socket.id,
                oldCallsign,
                newCallsign: user.callsign
            });
            
            broadcastChannelUpdate();
        }
    });
    
    // ==========================================
    // CHANNEL EVENTS
    // ==========================================
    
    // Join channel
    socket.on('channel:join', (channelId) => {
        const user = users.get(socket.id);
        if (!user) return;
        
        const oldChannel = user.currentChannel;
        const newChannel = channels.get(channelId) || privateChannels.get(channelId);
        
        if (!newChannel) {
            socket.emit('error', { message: 'Channel not found' });
            return;
        }
        
        // Leave old channel
        if (oldChannel) {
            socket.leave(oldChannel);
            const oldCh = channels.get(oldChannel) || privateChannels.get(oldChannel);
            if (oldCh) {
                oldCh.users.delete(socket.id);
                socket.to(oldChannel).emit('user:left', {
                    userId: socket.id,
                    callsign: user.callsign,
                    channelId: oldChannel
                });
            }
        }
        
        // Join new channel
        socket.join(channelId);
        newChannel.users.add(socket.id);
        user.currentChannel = channelId;
        
        console.log(`[${new Date().toISOString()}] ${user.callsign} joined ${channelId}`);
        
        // Notify others
        socket.to(channelId).emit('user:joined', {
            odId: socket.id,
            callsign: user.callsign,
            channelId
        });
        
        // Send channel history
        socket.emit('channel:history', {
            channelId,
            messages: getChannelMessages(channelId),
            users: getChannelUsers(channelId)
        });
        
        broadcastChannelUpdate();
    });
    
    // Create private channel
    socket.on('channel:create', (channelName) => {
        const user = users.get(socket.id);
        if (!user || !channelName || channelName.trim().length === 0) return;
        
        const name = channelName.trim().substring(0, 15);
        const id = 'private_' + uuidv4().substring(0, 8);
        
        // Check if name exists
        let exists = false;
        privateChannels.forEach(ch => {
            if (ch.name.toLowerCase() === name.toLowerCase()) exists = true;
        });
        
        if (exists) {
            socket.emit('error', { message: 'Ce nom existe déjà' });
            return;
        }
        
        privateChannels.set(id, {
            id,
            name,
            icon: '🔒',
            type: 'chat',
            createdBy: socket.id,
            users: new Set(),
            messages: []
        });
        
        console.log(`[${new Date().toISOString()}] Private channel created: ${name} by ${user.callsign}`);
        
        broadcastChannelUpdate();
        socket.emit('channel:created', { id, name });
    });
    
    // Delete private channel
    socket.on('channel:delete', (channelId) => {
        const channel = privateChannels.get(channelId);
        if (!channel) return;
        
        // Move all users to lobby
        channel.users.forEach(userId => {
            const userSocket = io.sockets.sockets.get(userId);
            if (userSocket) {
                userSocket.leave(channelId);
                userSocket.join('lobby');
                const u = users.get(userId);
                if (u) u.currentChannel = 'lobby';
                channels.get('lobby').users.add(userId);
            }
        });
        
        privateChannels.delete(channelId);
        
        console.log(`[${new Date().toISOString()}] Private channel deleted: ${channelId}`);
        
        io.emit('channel:deleted', { channelId });
        broadcastChannelUpdate();
    });
    
    // ==========================================
    // MORSE EVENTS
    // ==========================================
    
    // User is typing morse (real-time)
    socket.on('morse:typing', (data) => {
        const user = users.get(socket.id);
        if (!user || user.currentChannel === 'lobby') return;
        
        socket.to(user.currentChannel).emit('morse:typing', {
            odId: socket.id,
            callsign: user.callsign,
            currentMorse: data.currentMorse,
            currentText: data.currentText
        });
    });
    
    // User sends morse element (dit/dah) - for real-time audio sync
    socket.on('morse:element', (data) => {
        const user = users.get(socket.id);
        if (!user || user.currentChannel === 'lobby') return;
        
        socket.to(user.currentChannel).emit('morse:element', {
            odId: socket.id,
            callsign: user.callsign,
            element: data.element, // '.' or '-'
            duration: data.duration
        });
    });
    
    // User finalizes a letter
    socket.on('morse:letter', (data) => {
        const user = users.get(socket.id);
        if (!user || user.currentChannel === 'lobby') return;
        
        socket.to(user.currentChannel).emit('morse:letter', {
            odId: socket.id,
            callsign: user.callsign,
            letter: data.letter,
            morse: data.morse
        });
    });
    
    // User sends complete message
    socket.on('morse:message', (data) => {
        const user = users.get(socket.id);
        if (!user || user.currentChannel === 'lobby') return;
        
        const channel = channels.get(user.currentChannel) || privateChannels.get(user.currentChannel);
        if (!channel) return;
        
        const message = {
            id: uuidv4(),
            odId: socket.id,
            callsign: user.callsign,
            text: data.text,
            morse: data.morse,
            timestamp: new Date().toISOString(),
            time: new Date().toLocaleTimeString()
        };
        
        // Store message (limit to 100 per channel)
        channel.messages.push(message);
        if (channel.messages.length > 100) {
            channel.messages.shift();
        }
        
        console.log(`[${new Date().toISOString()}] [${user.currentChannel}] ${user.callsign}: ${data.text}`);
        
        // Broadcast to channel
        io.to(user.currentChannel).emit('morse:message', message);
    });
    
    // User stops typing (finished or cancelled)
    socket.on('morse:stopTyping', () => {
        const user = users.get(socket.id);
        if (!user) return;
        
        socket.to(user.currentChannel).emit('morse:stopTyping', {
            odId: socket.id,
            callsign: user.callsign
        });
    });
    
    // ==========================================
    // DISCONNECT
    // ==========================================
    
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        
        if (user) {
            console.log(`[${new Date().toISOString()}] User disconnected: ${user.callsign} (${socket.id})`);
            
            // Remove from current channel
            const channel = channels.get(user.currentChannel) || privateChannels.get(user.currentChannel);
            if (channel) {
                channel.users.delete(socket.id);
                socket.to(user.currentChannel).emit('user:left', {
                    odId: socket.id,
                    callsign: user.callsign,
                    channelId: user.currentChannel
                });
            }
            
            users.delete(socket.id);
            broadcastChannelUpdate();
        }
    });
});

// ==========================================
// REST API ROUTES
// ==========================================

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        users: users.size,
        channels: channels.size + privateChannels.size
    });
});

// Get stats
app.get('/api/stats', (req, res) => {
    const stats = {
        totalUsers: users.size,
        channelStats: {}
    };
    
    channels.forEach((ch, id) => {
        stats.channelStats[id] = {
            name: ch.name,
            users: ch.users.size,
            messages: ch.messages.length
        };
    });
    
    privateChannels.forEach((ch, id) => {
        stats.channelStats[id] = {
            name: ch.name,
            users: ch.users.size,
            messages: ch.messages.length,
            isPrivate: true
        };
    });
    
    res.json(stats);
});

// Serve index.html for all other routes (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ==========================================
// START SERVER
// ==========================================

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════╗
║     MORSE TRAINER PRO - SERVER             ║
╠════════════════════════════════════════════╣
║  🚀 Server running on port ${PORT}            ║
║  📡 WebSocket ready                        ║
║  🕐 Started: ${new Date().toISOString()}    ║
╚════════════════════════════════════════════╝
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
