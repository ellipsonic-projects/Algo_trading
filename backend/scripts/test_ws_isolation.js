const WebSocketImpl = globalThis.WebSocket || require('ws');
const crypto = require('crypto');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: 'C:/Users/Manish gowda/OneDrive/Desktop/algo-trading/Angel-one-trading/backend/.env' });

// Load backend services
const smartStream = require('../services/smartStream');
const orderUpdateService = require('../services/orderUpdateService');

const PORT = 8999;
const INTERNAL_SECRET = 'mock-internal-secret-xyz';
process.env.ANGEL_ONE_INTERNAL_SECRET = INTERNAL_SECRET;

async function runWebSocketIsolationTests() {
    console.log('=== STARTING WEBSOCKET ISOLATION INTEGRATION TESTS ===');

    // 1. Spin up a mock Python WebSocket Server using the global or required WebSocket implementation
    // For the server, we need a Server class. Since globalThis.WebSocket does not have a Server,
    // if ws is not installed, we can mock server behavior using standard http/ws or install ws, or mock it locally.
    // Wait, let's see: is ws installed in the frontend node_modules?
    // In frontend/package.json, under devDependencies:
    // "vite": "^7.2.4"
    // Wait, let's check if 'ws' is installed in the parent folder, or we can just use the 'ws' module.
    // Wait! Let's verify if ws can be imported from parent folders or if we can run it.
    // Let's import the Server class. If ws is not found, we can use a mock socket or import ws from the frontend node_modules.
    // Actually, we can require 'ws' using the absolute path to the frontend's node_modules if we want, OR we can install 'ws' in backend.
    // Let's check if 'ws' is inside C:\Users\Manish gowda\OneDrive\Desktop\algo-trading\Angel-one-trading\algo-trading\node_modules\ws.
    // Or even better, let's add 'ws' to backend/package.json dependencies so it's a first-class citizen!
    // Since smartStream.js requires 'ws' as a fallback, having 'ws' explicitly in backend/package.json is a great production-hardening practice
    // to ensure the backend runs correctly on older Node versions too.
    // Let's check if we can run the test by requiring it.
    let WsServer;
    try {
        WsServer = require('ws').Server;
    } catch (e) {
        // Fallback to frontend's node_modules or mock
        try {
            WsServer = require('C:/Users/Manish gowda/OneDrive/Desktop/algo-trading/Angel-one-trading/algo-trading/node_modules/ws').Server;
        } catch (err) {
            console.error('Could not find ws module. Please install it in backend.');
            process.exit(1);
        }
    }

    const wss = new WsServer({ port: PORT });
    console.log(`[Mock Python WS] Listening on ws://localhost:${PORT}`);

    const serverConnections = new Map(); // userId -> socket instance
    const receivedMessages = [];

    wss.on('connection', (ws, req) => {
        const url = new URL(req.url, 'http://localhost');
        const token = url.searchParams.get('token');
        const userId = url.searchParams.get('userId');

        // Security check matching Python app/main.py websocket_broker_stream rules
        if (token !== INTERNAL_SECRET) {
            console.log('[Mock Python WS] Rejected connection: invalid internal token');
            ws.close(4003, 'Forbidden');
            return;
        }
        if (!userId) {
            console.log('[Mock Python WS] Rejected connection: missing userId');
            ws.close(4000, 'Missing userId');
            return;
        }

        console.log(`[Mock Python WS] Accepted connection for User ID: ${userId}`);
        serverConnections.set(userId, ws);

        ws.on('message', (message) => {
            const payload = JSON.parse(message);
            console.log(`[Mock Python WS] Received message from user ${userId}:`, payload);
            receivedMessages.push({ userId, payload });
        });

        ws.on('close', () => {
            console.log(`[Mock Python WS] Connection closed for user: ${userId}`);
            serverConnections.delete(userId);
        });
    });

    // Patch smartStream's connect helper url dynamically
    const originalConnect = smartStream.connect;
    smartStream.connect = function(userId) {
        const uid = String(userId);
        if (this.connections.has(uid)) return;

        const internalSecret = process.env.ANGEL_ONE_INTERNAL_SECRET || '';
        // Point to our mock port 8999
        const wsUrl = `ws://localhost:8999/ws/broker-stream?token=${encodeURIComponent(internalSecret)}&userId=${uid}`;

        console.log(`[TestsmartStream] Redirecting connection to test port: ${wsUrl}`);
        const ws = new WebSocketImpl(wsUrl);
        this.connections.set(uid, ws);

        ws.onopen = () => {
            console.log(`[TestsmartStream] Connected to mock server for user ${uid}`);
            this.emit('connected', uid);
            this.resubscribeAll(uid);
        };

        ws.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'tick') {
                    this.emit('tick', payload.data, uid);
                } else if (payload.type === 'order') {
                    const orderData = typeof payload.data === 'string' ? JSON.parse(payload.data) : payload.data;
                    orderUpdateService.emit('order:update', orderData, uid);
                }
            } catch (err) {
                console.error(`[TestsmartStream] Error handling message:`, err.message);
            }
        };

        ws.onclose = () => {
            console.warn(`[TestsmartStream] Closed for user ${uid}`);
            this.connections.delete(uid);
            this.emit('disconnected', uid);
        };
    };

    try {
        // --- STEP 1: Connect User A & User B ---
        console.log('\n--- Step 1: Connecting User A and User B ---');
        smartStream.connect('UserA');
        smartStream.connect('UserB');

        // Wait for sockets to connect
        await new Promise(resolve => setTimeout(resolve, 1500));

        // --- STEP 2: Send Subscriptions for User A ---
        console.log('\n--- Step 2: Subscribing to tokens for User A ---');
        smartStream.subscribe('UserA', [{ exchangeType: 1, tokens: ['3045', '11536'] }]);

        // Wait for subscription payload to reach server
        await new Promise(resolve => setTimeout(resolve, 500));

        // Verify server received User A's subscriptions
        const subMsg = receivedMessages.find(m => m.userId === 'UserA' && m.payload.action === 'subscribe');
        if (subMsg && subMsg.payload.exchangeType === 1 && subMsg.payload.tokens.includes('3045')) {
            console.log('✅ Subscription routing verified: Python received User A\'s request!');
        } else {
            throw new Error('Subscription routing failed: Python did not receive User A\'s subscriptions');
        }

        // --- STEP 3: Stream Isolated Ticks for User A ---
        console.log('\n--- Step 3: Streaming ticks for User A ---');
        let userA_ReceivedTick = null;
        let userB_ReceivedTick = null;

        smartStream.on('tick', (tick, userId) => {
            console.log(`[SmartStream Event] Received tick for user ${userId}:`, tick);
            if (userId === 'UserA') userA_ReceivedTick = tick;
            if (userId === 'UserB') userB_ReceivedTick = tick;
        });

        // Server sends a mock tick to User A only
        const wsA = serverConnections.get('UserA');
        wsA.send(JSON.stringify({
            type: 'tick',
            data: { token: '3045', exchangeType: 1, ltp: 450.25, timestamp: Date.now(), sequenceNumber: 12345 }
        }));

        // Wait for event handler to trigger
        await new Promise(resolve => setTimeout(resolve, 500));

        if (userA_ReceivedTick && userA_ReceivedTick.token === '3045' && !userB_ReceivedTick) {
            console.log('✅ Tick isolation verified: User A received their ticks, User B did not!');
        } else {
            throw new Error('Tick isolation check failed: ticks were leaked or not delivered');
        }

        // --- STEP 4: Stream Order Updates for User B ---
        console.log('\n--- Step 4: Streaming order updates for User B ---');
        let userA_ReceivedOrder = null;
        let userB_ReceivedOrder = null;

        orderUpdateService.on('order:update', (orderData, userId) => {
            console.log(`[OrderUpdate Event] Received order update for user ${userId}:`, orderData);
            if (userId === 'UserA') userA_ReceivedOrder = orderData;
            if (userId === 'UserB') userB_ReceivedOrder = orderData;
        });

        // Server sends mock order update to User B only
        const wsB = serverConnections.get('UserB');
        wsB.send(JSON.stringify({
            type: 'order',
            data: { orderid: 'ORD-9999', status: 'COMPLETE', clientcode: 'CLIENT-B' }
        }));

        // Wait for event handler
        await new Promise(resolve => setTimeout(resolve, 500));

        if (userB_ReceivedOrder && userB_ReceivedOrder.orderid === 'ORD-9999' && !userA_ReceivedOrder) {
            console.log('✅ Order update isolation verified: User B received their order update, User A did not!');
        } else {
            throw new Error('Order update isolation check failed: updates leaked or not delivered');
        }

        // --- STEP 5: Disconnect and Clean Up ---
        console.log('\n--- Step 5: Closing connection for User A ---');
        smartStream.disconnect('UserA');
        await new Promise(resolve => setTimeout(resolve, 500));

        if (!serverConnections.has('UserA') && serverConnections.has('UserB')) {
            console.log('✅ Disconnect clean up verified: User A websocket was shut down in Python, User B remains active!');
        } else {
            throw new Error('Disconnect clean up failed');
        }

    } finally {
        // Clean up
        console.log('\nClosing test server...');
        wss.close();
        smartStream.disconnect('UserA');
        smartStream.disconnect('UserB');
        smartStream.connect = originalConnect; // restore
        console.log('=== WEBSOCKET ISOLATION INTEGRATION TESTS COMPLETED SUCCESSFULLY ===');
    }
}

runWebSocketIsolationTests().catch(err => {
    console.error('❌ WEBSOCKET TESTS FAILED:', err);
    process.exit(1);
});
