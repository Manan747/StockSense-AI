import time
from typing import Dict, Any, Optional

class SimpleCache:
    def __init__(self, default_expiry_seconds: int = 900):  # 15 minutes default
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.default_expiry_seconds = default_expiry_seconds

    def get(self, key: str) -> Optional[Any]:
        if key in self.cache:
            entry = self.cache[key]
            # Check if cache has expired
            if time.time() - entry["timestamp"] < entry["expiry"]:
                return entry["data"]
            else:
                # Expired cache removal
                del self.cache[key]
        return None

    def set(self, key: str, data: Any, expiry_seconds: Optional[int] = None) -> None:
        expiry = expiry_seconds if expiry_seconds is not None else self.default_expiry_seconds
        self.cache[key] = {
            "timestamp": time.time(),
            "data": data,
            "expiry": expiry
        }

    def clear(self) -> None:
        self.cache.clear()

# Global cache instance
screener_cache = SimpleCache(default_expiry_seconds=900)
