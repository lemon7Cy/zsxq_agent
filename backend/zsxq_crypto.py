"""
Knowledge Planet API encryption helper

Implements the current web client request envelope:
  - 客户端生成随机 AES-128 key 和 IV
  - RSA 加密 AES key → X-Key header
  - Base64(IV) → X-IV header
  - AES-CBC-PKCS7 加密 JSON body → request body (Base64)
  - 响应同样用相同 key/IV 做 AES-CBC 解密
"""
import base64
import json
import os

from cryptography.hazmat.primitives import padding, serialization
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

PUB_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArbJvWdwi4w96rNjQQQTs
qzMefjZVP5CrZ+5vNj/qG5zefzqZa9o87pAWzH3MG/HW+0k9DzHv33cxIk4yQcy6
NJb/QuDCLYUoCjkoefa6rienCTruyYNFhFt/JCCTNd2UecS914cbr+5YKp81mPGj
QuVBwu8akI7NVZLKe+vufhn0/sNeWzmn4v/kKWwsrWy1q+8LfKGidFiNMJtRDTHG
kRDOKW8M8sIgNowp1ot/m00QB65j1B/rqAsTLod0bSe0W++v5SEkNh+XrEO9/d+c
zsDOeUL+NqhO6+EPjwJVxHn0PnvgaNKQ51OpniNV9WLtEyjv/A674zot2zA9VEX/
MwIDAQAB
-----END PUBLIC KEY-----"""


def _generate_aes_key(length: int = 16) -> str:
    raw = base64.b64encode(os.urandom(length)).decode()
    return raw[:length]


class ZsxqCipher:
    def __init__(self):
        self.key_str = _generate_aes_key(16)
        self.iv_str = _generate_aes_key(16)
        self.key_bytes = self.key_str.encode()
        self.iv_bytes = self.iv_str.encode()

        pub_key = serialization.load_pem_public_key(PUB_KEY_PEM.encode())
        self.x_key = base64.b64encode(
            pub_key.encrypt(self.key_str.encode(), asym_padding.PKCS1v15())
        ).decode()
        self.x_iv = base64.b64encode(self.iv_str.encode()).decode()

    def encrypt(self, data: dict) -> str:
        plaintext = json.dumps(data, separators=(",", ":")).encode()
        padder = padding.PKCS7(128).padder()
        padded = padder.update(plaintext) + padder.finalize()
        cipher = Cipher(algorithms.AES(self.key_bytes), modes.CBC(self.iv_bytes))
        encryptor = cipher.encryptor()
        ct = encryptor.update(padded) + encryptor.finalize()
        return base64.b64encode(ct).decode()

    def decrypt(self, data: str) -> dict:
        ct = base64.b64decode(data)
        cipher = Cipher(algorithms.AES(self.key_bytes), modes.CBC(self.iv_bytes))
        decryptor = cipher.decryptor()
        padded = decryptor.update(ct) + decryptor.finalize()
        unpadder = padding.PKCS7(128).unpadder()
        plaintext = unpadder.update(padded) + unpadder.finalize()
        return json.loads(plaintext)

    def headers(self) -> dict[str, str]:
        return {"X-Key": self.x_key, "X-IV": self.x_iv}
