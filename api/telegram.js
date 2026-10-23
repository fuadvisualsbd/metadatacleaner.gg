export default async function handler(req, res) {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        let body = req.body;
        if (typeof body === "string") {
            try {
                body = JSON.parse(body);
            } catch (e) {
                return res.status(400).json({ error: "Invalid JSON payload" });
            }
        }

        const { text, parse_mode = "HTML" } = body || {};

        if (!text || typeof text !== "string") {
            return res.status(400).json({ error: "Message text is required" });
        }

        const primaryToken = process.env.TELEGRAM_BOT_TOKEN;
        const fallbackToken = process.env.TELEGRAM_FALLBACK_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;

        if (!primaryToken || !chatId) {
            console.error("[Telegram API] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env vars");
            return res.status(500).json({ error: "Telegram service not configured" });
        }

        const payload = {
            chat_id: chatId,
            text: text,
            parse_mode: parse_mode,
            disable_web_page_preview: true
        };

        // 1. Try Primary Bot
        let success = false;
        try {
            const primaryRes = await fetch(`https://api.telegram.org/bot${primaryToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await primaryRes.json();
            if (data.ok) {
                success = true;
            } else {
                console.warn("[Telegram API] Primary bot rejected:", data.description);
            }
        } catch (e) {
            console.warn("[Telegram API] Primary bot connection error:", e.message);
        }

        // 2. Try Fallback Bot if primary failed
        if (!success && fallbackToken) {
            try {
                const fallbackRes = await fetch(`https://api.telegram.org/bot${fallbackToken}/sendMessage`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                const data = await fallbackRes.json();
                if (data.ok) {
                    success = true;
                }
            } catch (e) {
                console.error("[Telegram API] Fallback bot failed:", e.message);
            }
        }

        if (success) {
            return res.status(200).json({ success: true });
        } else {
            return res.status(502).json({ error: "Failed to deliver Telegram message" });
        }
    } catch (err) {
        console.error("[Telegram API] Internal server error:", err);
        return res.status(500).json({ error: "Internal server error" });
    }
}
