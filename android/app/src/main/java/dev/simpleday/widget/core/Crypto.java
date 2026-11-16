package dev.simpleday.widget.core;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Same scheme as the web app (src/lib/crypto.js), the Mac widget and simpleday_sync.py:
 *   master = PBKDF2-HMAC-SHA256(secret, salt "simpleday-v1", 600000 iterations, 32 bytes)
 *   auth   = hex(HMAC-SHA256(master, "auth"))   -> X-Key header
 *   encKey =     HMAC-SHA256(master, "enc")     -> AES-256-GCM key
 */
public final class Crypto {
    private static final byte[] SALT = "simpleday-v1".getBytes(StandardCharsets.UTF_8);
    private static final int ITERATIONS = 600000;

    public static final class Keys {
        public final String auth;
        public final byte[] enc;
        Keys(String auth, byte[] enc) { this.auth = auth; this.enc = enc; }
    }

    private Crypto() {}

    private static byte[] hmac(byte[] key, byte[] data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(data);
    }

    /** PBKDF2 done by hand: one 32-byte block, so no platform quirks around password encoding. */
    static byte[] pbkdf2(byte[] password, byte[] salt, int iterations) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(password, "HmacSHA256"));
        mac.update(salt);
        byte[] u = mac.doFinal(new byte[] {0, 0, 0, 1});
        byte[] out = u.clone();
        for (int i = 1; i < iterations; i++) {
            u = mac.doFinal(u);
            for (int j = 0; j < out.length; j++) out[j] ^= u[j];
        }
        return out;
    }

    /** Slow on purpose (~1-3 s on a phone): call once at setup and store the result. */
    public static Keys derive(String secret) throws Exception {
        byte[] master = pbkdf2(secret.getBytes(StandardCharsets.UTF_8), SALT, ITERATIONS);
        byte[] auth = hmac(master, "auth".getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : auth) hex.append(String.format("%02x", b & 0xff));
        return new Keys(hex.toString(), hmac(master, "enc".getBytes(StandardCharsets.UTF_8)));
    }

    /** Envelope {v:1, iv: base64, ct: base64(ciphertext + 16-byte tag)} -> UTF-8 plaintext. */
    public static String open(byte[] encKey, String ivB64, String ctB64) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(encKey, "AES"),
                new GCMParameterSpec(128, Base64.getDecoder().decode(ivB64)));
        return new String(c.doFinal(Base64.getDecoder().decode(ctB64)), StandardCharsets.UTF_8);
    }
}
