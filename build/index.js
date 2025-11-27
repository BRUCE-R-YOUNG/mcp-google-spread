import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// プロジェクト直下の .env を明示パスで読む（Claudeがどのcwdで起動してもOK）
dotenv.config({ path: path.resolve(__dirname, "../.env") });
// src/index.ts
import { google } from "googleapis";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
/**
 * 環境変数からOAuth2クライアントを初期化
 * - 事前に発行した refresh_token を使ってサーバ側で無人リフレッシュ
 * - 取得方法はREADME参照（Playground など）
 */
function requireEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env ${name}`);
    return v;
}
function getOAuthClient() {
    const GOOGLE_CLIENT_ID = requireEnv("GOOGLE_CLIENT_ID");
    const GOOGLE_CLIENT_SECRET = requireEnv("GOOGLE_CLIENT_SECRET");
    const GOOGLE_REFRESH_TOKEN = requireEnv("GOOGLE_REFRESH_TOKEN");
    const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost";
    const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    oAuth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    return oAuth2Client;
}
function previewEnv() {
    const mask = (s) => (s ? `${s.slice(0, 4)}…(${s.length})` : "(none)");
    console.error("[ENV CHECK]", "CLIENT_ID:", mask(process.env.GOOGLE_CLIENT_ID), "SECRET:", mask(process.env.GOOGLE_CLIENT_SECRET), "REFRESH:", mask(process.env.GOOGLE_REFRESH_TOKEN), "REDIRECT:", process.env.GOOGLE_REDIRECT_URI);
}
previewEnv();
/**
 * Google Calendar から予定を取得
 */
async function fetchCalendarEvents(args) {
    const auth = getOAuthClient();
    const calendar = google.calendar({ version: "v3", auth });
    const { calendarId = "primary", timeMin, timeMax, maxResults = 100, singleEvents = true, orderBy = "startTime", q, } = args || {};
    const res = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        maxResults,
        singleEvents,
        orderBy,
        q,
    });
    return res.data;
}
// ---------------- MCP Server ----------------
const server = new Server({ name: "sensor-mcp", version: "1.0.0" }, // 既存名を踏襲（binも同じ）
{ capabilities: { tools: {} } });
// 利用可能なツール一覧
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_calendar_events",
                description: "Googleカレンダーから予定を取得します。timeMin/timeMaxはISO8601（例: 2025-10-20T00:00:00+09:00）",
                inputSchema: {
                    type: "object",
                    properties: {
                        calendarId: {
                            type: "string",
                            description: "カレンダーID（未指定なら primary）",
                        },
                        timeMin: {
                            type: "string",
                            description: "開始時刻（ISO8601）。未指定可",
                        },
                        timeMax: {
                            type: "string",
                            description: "終了時刻（ISO8601）。未指定可",
                        },
                        maxResults: {
                            type: "number",
                            description: "最大件数（デフォルト100）",
                        },
                        singleEvents: {
                            type: "boolean",
                            description: "繰り返し予定を展開するか（デフォルトtrue）",
                        },
                        orderBy: {
                            type: "string",
                            enum: ["startTime", "updated"],
                            description: "並び順（デフォルトstartTime）",
                        },
                        q: {
                            type: "string",
                            description: "フリーテキスト検索（任意）",
                        },
                    },
                },
            },
        ],
    };
});
// ツール呼び出し
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "get_calendar_events") {
        throw new Error("Unknown tool");
    }
    try {
        const data = await fetchCalendarEvents(request.params.arguments || {});
        // Claudeに扱いやすいよう JSON文字列で返す
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(data),
                },
            ],
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: "text",
                    text: `Calendar fetch failed: ${err?.message ?? String(err)}`,
                },
            ],
            isError: true,
        };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("sensor-mcp (Google Calendar) running over stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
