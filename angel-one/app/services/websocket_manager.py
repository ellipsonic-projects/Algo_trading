from __future__ import annotations

import asyncio
import logging
import struct
from typing import Any, Dict, Set, Optional
from fastapi import WebSocket
import websockets

from SmartApi.smartWebSocketV2 import SmartWebSocketV2
from app.services.session_manager import session_manager

logger = logging.getLogger("uvicorn.error")

# LTP Mode binary struct format (Mode 1 LTP = 51 bytes)
# Indexes: 0=sub_mode (1B), 1=exch_type (1B), 2-26=token (25B), 27-34=seq (8B), 35-42=timestamp (8B), 43-46=ltp (4B)
STRUCT_FORMAT = "<bb25sqqi"

def decode_ltp_packet(message: bytes) -> Optional[Dict[str, Any]]:
    """Decode raw binary LTP mode 1 tick data from Smart Stream."""
    try:
        if len(message) < 47:
            return None
        sub_mode, exch_type, token_bytes, seq, timestamp, raw_ltp = struct.unpack_from(STRUCT_FORMAT, message, 0)
        token = token_bytes.decode("utf-8").strip("\x00").strip()
        ltp = raw_ltp / 100.0
        return {
            "token": token,
            "exchangeType": int(exch_type),
            "ltp": ltp,
            "timestamp": int(timestamp) if timestamp > 0 else int(asyncio.get_event_loop().time() * 1000),
            "sequenceNumber": int(seq)
        }
    except Exception as e:
        logger.error(f"[WebSocketManager] Error unpacking binary tick: {e}")
        return None


class UserWebSocketConnection:
    def __init__(self, user_id: str, fastapi_ws: WebSocket, loop: asyncio.AbstractEventLoop) -> None:
        self.user_id = user_id
        self.fastapi_ws = fastapi_ws
        self.loop = loop
        self.smart_stream: Optional[SmartWebSocketV2] = None
        self.order_task: Optional[asyncio.Task] = None
        self.subscribed_tokens: Set[str] = set()
        self.is_active = True

    async def start(self, jwt_token: str, feed_token: str, client_code: str, api_key: str) -> None:
        """Initialize and start both the Smart Stream (ticks) and Order Update websockets."""
        logger.info(f"[WebSocketManager] Starting WebSockets for user: {self.user_id}")

        # 1. Start Order Update background task
        self.order_task = asyncio.create_task(self._run_order_updates(jwt_token))

        # 2. Start Smart Stream 2.0 Client (runs in its own background thread)
        try:
            self.smart_stream = SmartWebSocketV2(
                auth_token=jwt_token,
                api_key=api_key,
                client_code=client_code,
                feed_token=feed_token,
                max_retry_attempt=5,
                retry_delay=5
            )

            # Thread-safe callback bridge
            def on_data(ws, message):
                if not self.is_active:
                    return
                # Only LTP packets are expected in Mode 1
                tick = decode_ltp_packet(message)
                if tick:
                    payload = {"type": "tick", "data": tick}
                    asyncio.run_coroutine_threadsafe(self._send_payload(payload), self.loop)

            def on_close(ws, code, reason):
                logger.warning(f"[WebSocketManager] Smart Stream closed for user {self.user_id}: {reason}")

            def on_error(ws, error):
                logger.error(f"[WebSocketManager] Smart Stream error for user {self.user_id}: {error}")

            self.smart_stream.on_data = on_data
            self.smart_stream.on_close = on_close
            self.smart_stream.on_error = on_error

            # Run connection inside thread
            import threading
            thread = threading.Thread(target=self.smart_stream.connect, name=f"SmartStream-{self.user_id}", daemon=True)
            thread.start()

        except Exception as e:
            logger.error(f"[WebSocketManager] Failed to start Smart Stream for user {self.user_id}: {e}")

    async def _send_payload(self, payload: Dict[str, Any]) -> None:
        """Safely send JSON payload back to Node.js over the active FastAPI socket."""
        if not self.is_active:
            return
        try:
            await self.fastapi_ws.send_json(payload)
        except Exception:
            # Socket closed or failed, cleanup will trigger
            self.is_active = False

    async def _run_order_updates(self, jwt_token: str) -> None:
        """Asynchronous listener for the Order Update WebSocket.

        Automatically refreshes the Angel One JWT token when a 1011 (internal
        error / token expired) disconnect is received, so reconnects succeed.
        """
        uri = "wss://tns.angelone.in/smart-order-update"
        current_token = jwt_token
        backoff = 1

        while self.is_active:
            headers = {"Authorization": f"Bearer {current_token}"}
            try:
                logger.info(f"[WebSocketManager] Connecting order updates for user: {self.user_id}")
                async with websockets.connect(uri, additional_headers=headers) as ws:
                    backoff = 1  # reset on successful connect
                    while self.is_active:
                        msg = await ws.recv()
                        if msg == "pong" or msg == "ping":
                            continue
                        # Order update messages are JSON text
                        payload = {"type": "order", "data": msg}
                        await self._send_payload(payload)

            except asyncio.CancelledError:
                break
            except websockets.exceptions.ConnectionClosedError as e:
                # Code 1011 = server internal error, almost always means the
                # Angel One JWT has expired. Refresh before retrying.
                if e.code == 1011:
                    logger.warning(
                        f"[WebSocketManager] Order WS token expired for user {self.user_id} "
                        f"(code 1011). Refreshing Angel One token..."
                    )
                    try:
                        client = session_manager.get_session(self.user_id)
                        if client and client._session:
                            refresh_result = await asyncio.get_event_loop().run_in_executor(
                                None, client.refresh_session, client._session.refresh_token
                            )
                            current_token = refresh_result["jwt_token"]
                            logger.info(
                                f"[WebSocketManager] Token refreshed for user {self.user_id}. Reconnecting..."
                            )
                            backoff = 1  # reset backoff after successful refresh
                        else:
                            logger.warning(
                                f"[WebSocketManager] No active session for user {self.user_id}. "
                                f"Cannot refresh token. Retrying in {backoff}s..."
                            )
                            await asyncio.sleep(backoff)
                            backoff = min(backoff * 2, 60)
                    except Exception as refresh_err:
                        logger.error(
                            f"[WebSocketManager] Token refresh failed for user {self.user_id}: "
                            f"{refresh_err}. Retrying in {backoff}s..."
                        )
                        await asyncio.sleep(backoff)
                        backoff = min(backoff * 2, 60)
                else:
                    logger.warning(
                        f"[WebSocketManager] Order WS disconnect for user {self.user_id}: "
                        f"{e}. Retrying in {backoff}s..."
                    )
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 30)
            except Exception as e:
                logger.warning(
                    f"[WebSocketManager] Order WS disconnect for user {self.user_id}: "
                    f"{e}. Retrying in {backoff}s..."
                )
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    def subscribe(self, exchange_type: int, tokens: list[str]) -> None:
        """Subscribe to tokens on Smart Stream."""
        if self.smart_stream and self.smart_stream.wsapp:
            correlation_id = f"sub_{self.user_id}_{int(asyncio.get_event_loop().time())}"
            token_list = [{"exchangeType": exchange_type, "tokens": tokens}]
            # Mode 1 = LTP Mode
            self.smart_stream.subscribe(correlation_id, 1, token_list)
            for t in tokens:
                self.subscribed_tokens.add(t)

    def unsubscribe(self, exchange_type: int, tokens: list[str]) -> None:
        """Unsubscribe from tokens on Smart Stream."""
        if self.smart_stream and self.smart_stream.wsapp:
            correlation_id = f"unsub_{self.user_id}_{int(asyncio.get_event_loop().time())}"
            token_list = [{"exchangeType": exchange_type, "tokens": tokens}]
            self.smart_stream.unsubscribe(correlation_id, 1, token_list)
            for t in tokens:
                self.subscribed_tokens.discard(t)

    async def stop(self) -> None:
        """Stop and clean up all WebSockets for this user session."""
        logger.info(f"[WebSocketManager] Cleaning up WebSockets for user: {self.user_id}")
        self.is_active = False

        if self.order_task:
            self.order_task.cancel()
            try:
                await self.order_task
            except asyncio.CancelledError:
                pass

        if self.smart_stream:
            try:
                self.smart_stream.close_connection()
            except Exception as e:
                logger.error(f"[WebSocketManager] Error closing Smart Stream: {e}")
