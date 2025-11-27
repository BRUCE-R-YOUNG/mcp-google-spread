// quick-test.js
import { google } from "googleapis";

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_REDIRECT_URI = "http://localhost",
} = process.env;

async function main() {
  const oauth2 = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });

  // アクセストークンを試しにリフレッシュ
  const t = await oauth2.getAccessToken();
  console.log("access_token OK:", !!t?.token);

  const cal = google.calendar({ version: "v3", auth: oauth2 });
  const res = await cal.calendarList.list({ maxResults: 5 });
  console.log("calendarList entries:", res.data.items?.length ?? 0);

  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400 * 1000);
  const events = await cal.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: in7.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 5,
  });
  console.log("events:", events.data.items?.length ?? 0);
}
main().catch((e) => {
  console.error("TEST FAILED:", e.response?.data ?? e.message);
  process.exit(1);
});
