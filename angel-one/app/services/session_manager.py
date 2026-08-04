from __future__ import annotations

from typing import Dict, List, Optional
from app.services.angel_client import AngelClient

class UserSessionManager:
    def __init__(self) -> None:
        self._sessions: Dict[str, AngelClient] = {}

    def get_session(self, user_id: str) -> Optional[AngelClient]:
        """Retrieve an active AngelClient session for a specific user ID."""
        return self._sessions.get(user_id)

    def create_session(self, user_id: str, *, client_code: str, api_key: str) -> AngelClient:
        """Create and register a new user-scoped AngelClient instance."""
        client = AngelClient(api_key=api_key, client_code=client_code)
        self._sessions[user_id] = client
        return client

    def remove_session(self, user_id: str) -> None:
        """Revoke and clean up the session for a specific user ID."""
        if user_id in self._sessions:
            del self._sessions[user_id]

    def list_active_sessions(self) -> List[str]:
        """List all user IDs with currently loaded sessions."""
        return list(self._sessions.keys())

# Global singleton session manager
session_manager = UserSessionManager()
