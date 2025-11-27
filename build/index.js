// src/index.ts
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// プロジェクト直下の .env を明示パスで読む
dotenv.config({ path: path.resolve(__dirname, "../.env") });
import { google } from "googleapis";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
/**
 * 環境変数読み出し（必須チェック付き）
 */
function requireEnv(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env ${name}`);
    return v;
}
/**
 * OAuth2 クライアント生成
 * - Calendar の時と同じく refresh_token で無人リフレッシュ
 */
function getOAuthClient() {
    const GOOGLE_CLIENT_ID = requireEnv("GOOGLE_CLIENT_ID");
    const GOOGLE_CLIENT_SECRET = requireEnv("GOOGLE_CLIENT_SECRET");
    const GOOGLE_REFRESH_TOKEN = requireEnv("GOOGLE_REFRESH_TOKEN");
    const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "http://localhost";
    const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    oAuth2Client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    return oAuth2Client;
}
/**
 * 起動時に環境変数マスク表示（デバッグ用）
 */
function previewEnv() {
    const mask = (s) => (s ? `${s.slice(0, 4)}…(${s.length})` : "(none)");
    console.error("[ENV CHECK]", "CLIENT_ID:", mask(process.env.GOOGLE_CLIENT_ID), "SECRET:", mask(process.env.GOOGLE_CLIENT_SECRET), "REFRESH:", mask(process.env.GOOGLE_REFRESH_TOKEN), "REDIRECT:", process.env.GOOGLE_REDIRECT_URI);
}
previewEnv();
/**
 * Google Spreadsheet から値を取得
 * - spreadsheets.values.get の薄いラッパ
 */
async function fetchSpreadsheetValues(args) {
    const auth = getOAuthClient();
    const sheets = google.sheets({ version: "v4", auth });
    const { spreadsheetId, range, majorDimension, valueRenderOption, dateTimeRenderOption, } = args;
    if (!spreadsheetId) {
        throw new Error("spreadsheetId is required");
    }
    if (!range) {
        throw new Error("range is required (A1 notation)");
    }
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
        majorDimension,
        valueRenderOption,
        dateTimeRenderOption,
    });
    return res.data;
}
// -------------- MCP Server 本体 --------------
const server = new Server({ name: "spreadsheet-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
/**
 * 利用可能なツール一覧
 * - Google Spreadsheet から値を取得するツールを1つ公開
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_spreadsheet_values",
                description: "Googleスプレッドシートから指定レンジの値を取得します（spreadsheets.values.get）。",
                inputSchema: {
                    type: "object",
                    properties: {
                        spreadsheetId: {
                            type: "string",
                            description: "スプレッドシートID（URL中の /spreadsheets/d/ の後の部分）",
                        },
                        range: {
                            type: "string",
                            description: 'A1表記のレンジ（例: "シート1!A2:D100"）。シート名なしならアクティブシートのレンジ。',
                        },
                        majorDimension: {
                            type: "string",
                            enum: ["ROWS", "COLUMNS"],
                            description: "値の配列の次元。デフォルトは ROWS（行単位）",
                        },
                        valueRenderOption: {
                            type: "string",
                            enum: ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"],
                            description: "値の表示方法。デフォルト FORMATTED_VALUE（表示形式適用済みの値）",
                        },
                        dateTimeRenderOption: {
                            type: "string",
                            enum: ["SERIAL_NUMBER", "FORMATTED_STRING"],
                            description: "日付・時刻の表現方法。デフォルトはロケールに応じた文字列。",
                        },
                    },
                    required: ["spreadsheetId", "range"],
                },
            },
        ],
    };
});
/**
 * ツール呼び出し処理
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "get_spreadsheet_values") {
        throw new Error("Unknown tool");
    }
    try {
        const data = await fetchSpreadsheetValues(request.params.arguments || {});
        // Claude が扱いやすいよう JSON 文字列で返す
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
                    text: `Spreadsheet fetch failed: ${err?.message ?? String(err)}`,
                },
            ],
            isError: true,
        };
    }
});
/**
 * 標準入出力で MCP サーバとして起動
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("spreadsheet-mcp (Google Sheets) running over stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
