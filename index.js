const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

// Enable CORS for all routes
app.use(cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST"],
    credentials: true
}));

const server = http.createServer(app);

// Socket.IO server configuration
const io = new Server(server, {
    cors: {
        origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

// Store active users and their room data
const userSocketMap = new Map();
const roomCodeMap = new Map();
const activeRooms = new Map();

// Helper function to get room users
const getRoomUsers = (roomId) => {
    const room = activeRooms.get(roomId);
    return room ? Array.from(room.values()) : [];
};

io.on("connection", (socket) => {
    console.log('Socket connected:', socket.id);

    // Send immediate acknowledgment
    socket.emit('connection:ack', { id: socket.id });

    // Handle initial connection error
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
    });

    socket.on("join", ({ roomId, email }) => {
        try {
            console.log(`Join attempt - Room: ${roomId}, Email: ${email}`);
            
            if (!roomId || !email) {
                throw new Error('Room ID and email are required');
            }
            
            // Store user data
            userSocketMap.set(socket.id, { email, roomId });
            
            // Join the room
            socket.join(roomId);
            
            // Update active rooms
            if (!activeRooms.has(roomId)) {
                activeRooms.set(roomId, new Map());
            }
            activeRooms.get(roomId).set(socket.id, { email, socketId: socket.id });

            // Get current room state
            const roomUsers = getRoomUsers(roomId);
            const currentCode = roomCodeMap.get(roomId) || '// Start coding here...';

            console.log('Room state before emitting:', {
                roomId,
                email,
                users: roomUsers,
                hasCode: !!currentCode
            });

            // Emit join confirmation to the user who joined
            socket.emit("joined", {
                roomId,
                email,
                users: roomUsers,
                code: currentCode
            });
            
            // Notify others in the room
            socket.to(roomId).emit("user:joined", {
                email,
                socketId: socket.id
            });
            
            console.log(`${email} joined room ${roomId}`);
            console.log('Room users:', roomUsers);
        } catch (error) {
            console.error('Error in join event:', error);
            socket.emit("error", { message: "Failed to join room: " + error.message });
        }
    });

    // Handle code changes
    socket.on("code-change", ({ roomId, code, cursorPosition }) => {
        try {
            roomCodeMap.set(roomId, code);
            socket.to(roomId).emit("code-changed", { 
                code,
                cursorPosition,
                changedBy: socket.id
            });
        } catch (error) {
            console.error('Error in code-change event:', error);
        }
    });

    // Handle cursor position updates
    socket.on("cursor-move", ({ roomId, cursorPosition }) => {
        try {
            socket.to(roomId).emit("cursor-moved", {
                cursorPosition,
                movedBy: socket.id
            });
        } catch (error) {
            console.error('Error in cursor-move event:', error);
        }
    });

    // Handle selection updates
    socket.on("selection-change", ({ roomId, selection }) => {
        try {
            socket.to(roomId).emit("selection-changed", {
                selection,
                changedBy: socket.id
            });
        } catch (error) {
            console.error('Error in selection-change event:', error);
        }
    });

    // Enhanced disconnect handling
    socket.on("disconnect", (reason) => {
        const userData = userSocketMap.get(socket.id);
        console.log(`Socket disconnected: ${socket.id} - Reason: ${reason}`);
        console.log('User data:', userData);

        if (userData) {
            const { email, roomId } = userData;
            
            // Clean up user data
            userSocketMap.delete(socket.id);

            // Update active rooms and notify others
            const room = activeRooms.get(roomId);
            if (room) {
                room.delete(socket.id);
                socket.to(roomId).emit("user:disconnected", {
                    socketId: socket.id,
                    email
                });

                // Remove room if empty
                if (room.size === 0) {
                    activeRooms.delete(roomId);
                    roomCodeMap.delete(roomId);
                    console.log(`Room ${roomId} deleted - no users remaining`);
                }
            }
        }
    });

    // WebRTC signaling events
    socket.on("user:call", ({ to, offer }) => {
        io.to(to).emit("incomming:call", { from: socket.id, offer });
    });

    socket.on("call:accepted", ({ to, ans }) => {
        io.to(to).emit("call:accepted", { from: socket.id, ans });
    });

    socket.on("peer:nego:needed", ({ to, offer }) => {
        io.to(to).emit("peer:nego:needed", { from: socket.id, offer });
    });

    socket.on("peer:nego:done", ({ to, ans }) => {
        io.to(to).emit("peer:nego:final", { from: socket.id, ans });
    });

    socket.on("screen:start", ({ to }) => {
        io.to(to).emit("screen:started", { from: socket.id });
    });

    socket.on("screen:stop", ({ to }) => {
        io.to(to).emit("screen:stopped", { from: socket.id });
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        connections: io.engine.clientsCount,
        rooms: Array.from(activeRooms.keys()),
        timestamp: new Date().toISOString()
    });
});

// Basic error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});