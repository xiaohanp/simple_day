package dev.simpleday.widget.core;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Read-only client for the SimpleDay worker: GET /state, decrypt, return the plan text. */
public final class Api {
    public static final class State {
        public String text = "";
        public String tz = "Europe/Paris";
        public long updatedAt;
    }

    public static final class HttpError extends IOException {
        public final int code;
        HttpError(int code, String msg) { super(msg); this.code = code; }
    }

    private Api() {}

    public static State fetch(String workerUrl, String auth, byte[] encKey) throws Exception {
        String base = workerUrl.trim().replaceAll("/+$", "");
        HttpURLConnection c = (HttpURLConnection) new URL(base + "/state").openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setRequestProperty("X-Key", auth);
        // Cloudflare rejects some default library User-Agents (error 1010)
        c.setRequestProperty("User-Agent", "SimpleDayAndroidWidget/1.0");
        c.setRequestProperty("Accept", "application/json");
        int code = c.getResponseCode();
        if (code == 403) throw new HttpError(code, "Wrong secret key (403)");
        if (code == 404) throw new HttpError(code, "Nothing stored on this worker yet (404)");
        if (code != 200) throw new HttpError(code, "Worker error " + code);
        JSONObject st = new JSONObject(read(c.getInputStream()));
        c.disconnect();

        State out = new State();
        out.updatedAt = st.optLong("updatedAt");
        JSONObject settings = st.optJSONObject("settings");
        if (settings != null && !settings.optString("tz").isEmpty()) out.tz = settings.optString("tz");
        JSONObject enc = st.optJSONObject("enc");
        if (enc != null) {
            JSONObject plain = new JSONObject(Crypto.open(encKey, enc.getString("iv"), enc.getString("ct")));
            out.text = plain.optString("text");
        } else {
            out.text = st.optString("text"); // pre-encryption worker
        }
        return out;
    }

    private static String read(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] b = new byte[8192];
        int n;
        while ((n = in.read(b)) > 0) buf.write(b, 0, n);
        in.close();
        return buf.toString(StandardCharsets.UTF_8.name());
    }
}
