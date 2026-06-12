import os
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PrivateFormat,
    PublicFormat,
    NoEncryption,
)
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes


class SeshCrypto:
    def __init__(self, secret: X25519PrivateKey, public: X25519PublicKey):
        self._secret = secret
        self._public = public

    @classmethod
    def load_or_generate(cls, key_dir: str) -> "SeshCrypto":
        key_path = Path(key_dir) / "e2ee_secret.key"
        pub_path = Path(key_dir) / "e2ee_public.key"

        if key_path.exists() and pub_path.exists():
            secret_bytes = key_path.read_bytes()
            secret = X25519PrivateKey.from_private_bytes(secret_bytes)
            public = X25519PublicKey.from_public_bytes(pub_path.read_bytes())
            return cls(secret, public)

        key_dir_path = Path(key_dir)
        key_dir_path.mkdir(parents=True, exist_ok=True)
        secret = X25519PrivateKey.generate()
        public = secret.public_key()
        key_path.write_bytes(
            secret.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
        )
        pub_path.write_bytes(
            public.public_bytes(Encoding.Raw, PublicFormat.Raw)
        )
        return cls(secret, public)

    def public_key_bytes(self) -> bytes:
        return self._public.public_bytes(Encoding.Raw, PublicFormat.Raw)

    @staticmethod
    def _derive_shared(secret: X25519PrivateKey, peer_pub_bytes: bytes) -> bytes:
        peer_pub = X25519PublicKey.from_public_bytes(peer_pub_bytes)
        shared = secret.exchange(peer_pub)
        hkdf = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=None,
            info=b"sesh-e2ee-v1",
        )
        return hkdf.derive(shared)

    def encrypt(self, recipient_pub: bytes, plaintext: bytes) -> bytes:
        key = self._derive_shared(self._secret, recipient_pub)
        aead = ChaCha20Poly1305(key)
        nonce = os.urandom(12)
        ciphertext = aead.encrypt(nonce, plaintext, None)
        return nonce + ciphertext

    def decrypt(self, sender_pub: bytes, ciphertext: bytes) -> bytes:
        if len(ciphertext) < 12:
            raise ValueError("ciphertext too short")
        key = self._derive_shared(self._secret, sender_pub)
        aead = ChaCha20Poly1305(key)
        nonce = ciphertext[:12]
        return aead.decrypt(nonce, ciphertext[12:], None)
