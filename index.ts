import { randomUUID } from "crypto";
import express from "express";

const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID ?? "";
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET ?? "";
const BASE_URL = process.env.BASE_URL ?? "";
let RECALL_CALLBACK_SECRET = process.env.RECALL_CALLBACK_SECRET ?? "";
const RECALL_API_KEY = process.env.RECALL_API_KEY ?? "";

if (!ZOOM_CLIENT_ID) {
  console.error("missing required environment variable: ZOOM_CLIENT_ID");
  process.exit(1);
}
if (!ZOOM_CLIENT_SECRET) {
  console.error("missing required environment variable: ZOOM_CLIENT_SECRET");
  process.exit(1);
}
if (!BASE_URL) {
  console.error("missing required environment variable: BASE_URL (hint: set to the public URL of this server, e.g. https://your-ngrok-url.ngrok.io)");
  process.exit(1);
}
if (!RECALL_CALLBACK_SECRET) {
  console.warn("RECALL_CALLBACK_SECRET is not set. setting to the default value of 'helloWorld'");
  RECALL_CALLBACK_SECRET = "helloWorld";
}

const TOKEN_REFRESH_INTERVAL_MS = 20 * 60 * 1000;

interface UserTokens {
  visibleUserId: string;
  accessToken: string;
  refreshToken: string;
  refreshIntervalId: NodeJS.Timeout | null;
}

const users = new Map<string, UserTokens>();

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  api_url: string;
}

interface TokenResponse {
  token: string;
}

function generateAuthorizationHeader(): string {
  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString("base64");
  return `Basic ${credentials}`;
}

async function generateOAuthToken(authCode: string): Promise<{ accessToken: string; refreshToken: string }> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: authCode,
    redirect_uri: `${BASE_URL}/zoom/oauth-callback`,
  });

  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: generateAuthorizationHeader(),
    },
    body: params.toString(),
  });

  const data = (await response.json()) as OAuthTokenResponse;
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

async function refreshOAuthToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: generateAuthorizationHeader(),
    },
    body: params.toString(),
  });

  const data = (await response.json()) as OAuthTokenResponse;
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

async function generateObfToken(accessToken: string): Promise<string> {
  const url = `https://api.zoom.us/v2/users/me/token?type=onbehalf`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = (await response.json()) as TokenResponse;
  return data.token;
}

async function generateZakToken(accessToken: string): Promise<string> {
  let url = "https://api.zoom.us/v2/users/me/token?type=zak";

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = (await response.json()) as TokenResponse;
  return data.token;
}

function verifyRequestIsFromRecall(authToken: string | undefined): boolean {
  return authToken === RECALL_CALLBACK_SECRET;
}

function getCookie(req: express.Request, name: string): string | undefined {
  const cookies = req.headers.cookie?.split("; ") ?? [];
  for (const cookie of cookies) {
    const [key, value] = cookie.split("=");
    if (key === name) return value;
  }
  return undefined;
}

const app = express();
app.use(express.urlencoded({ extended: true }));

app.get("/zoom/oauth", (_req, res) => {
  const redirectUri = `${BASE_URL}/zoom/oauth-callback`;
  const url = `https://zoom.us/oauth/authorize?response_type=code&client_id=${ZOOM_CLIENT_ID}&redirect_uri=${redirectUri}`;
  res.redirect(url);
});

app.get("/zoom/oauth-callback", async (req, res) => {
  const authCode = req.query.code as string | undefined;
  if (!authCode) {
    console.error("no auth code provided for oauth handler");
    res.status(400).send("no auth code provided for oauth handler");
    return;
  }

  try {
    const tokens = await generateOAuthToken(authCode);
    const userId = randomUUID();

    const existingUser = users.get(userId);
    if (existingUser?.refreshIntervalId) {
      clearInterval(existingUser.refreshIntervalId);
    }

    const userTokens: UserTokens = {
      visibleUserId: userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      refreshIntervalId: null,
    };

    userTokens.refreshIntervalId = setInterval(async () => {
      try {
        const newTokens = await refreshOAuthToken(userTokens.refreshToken);
        userTokens.accessToken = newTokens.accessToken;
        userTokens.refreshToken = newTokens.refreshToken;
      } catch (error) {
        console.error("error refreshing oauth token", error);
      }
    }, TOKEN_REFRESH_INTERVAL_MS);

    users.set(userId, userTokens);

    res.cookie("zoom_user_id", userId, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.send(`successfully generated and stored oauth token ${tokens.accessToken} for user: ${userId}`);
  } catch (error) {
    console.error("error generating oauth token", error);
    res.status(500).send("failed to generate oauth token");
  }
});

app.get("/me", (req, res) => {
  const userId = getCookie(req, "zoom_user_id");
  if (!userId) {
    res.status(401).send("not authenticated. please visit /zoom/oauth");
    return;
  }

  const userTokens = users.get(userId);
  if (!userTokens) {
    res.status(404).send(`no tokens found for user: ${userId}. please visit /zoom/oauth`);
    return;
  }

  res.json({
    user_id: userId,
    has_oauth_token: !!userTokens.accessToken,
  });
});

app.get("/launch", (req, res) => {
  const userId = getCookie(req, "zoom_user_id");
  if (!userId || !users.has(userId)) {
    res.status(401).send("not authenticated. please visit /zoom/oauth first");
    return;
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Launch Bot</title></head>
    <body>
      <h1>Launch Recording Bot</h1>
      <p>Logged in as: ${userId}</p>
      <form method="POST" action="/launch">
        <label>Zoom Meeting URL:</label><br>
        <input type="text" name="meeting_url" style="width: 400px" placeholder="https://zoom.us/j/123456789" required><br><br>
        <button type="submit">Launch Bot</button>
      </form>
    </body>
    </html>
  `);
});

app.post("/launch", async (req, res) => {
  const userId = getCookie(req, "zoom_user_id");
  if (!userId || !users.has(userId)) {
    res.status(401).send("not authenticated. please visit /zoom/oauth first");
    return;
  }

  if (!RECALL_API_KEY) {
    res.status(500).send("RECALL_API_KEY is not configured");
    return;
  }

  const meetingUrl = req.body.meeting_url as string | undefined;
  if (!meetingUrl) {
    res.status(400).send("meeting_url is required");
    return;
  }

  const obfTokenUrl = `${BASE_URL}/recall/obf-callback?auth_token=${RECALL_CALLBACK_SECRET}&user_id=${userId}`;

  try {
    const response = await fetch("https://us-east-1.recall.ai/api/v1/bot", {
      method: "POST",
      headers: {
        "Authorization": `Token ${RECALL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: "Recall Bot",
        zoom: {
            obf_token_url: obfTokenUrl,
        },
        automatic_leave: {
          // you can set the waiting room timeout to determine how long the bot will wait for the OBF user to join the meeting
          waiting_room_timeout: 1200,
        }
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("recall API error:", data);
      res.status(response.status).send(`recall API error: ${JSON.stringify(data)}`);
      return;
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Bot Launched</title></head>
      <body>
        <h1>Bot Launched Successfully</h1>
        <p>Bot ID: ${(data as { id: string }).id}</p>
        <p><a href="/launch">Launch another</a></p>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("error launching bot:", error);
    res.status(500).send("error launching bot");
  }
});

app.get("/recall/oauth-callback", (req, res) => {
  if (!verifyRequestIsFromRecall(req.query.auth_token as string | undefined)) {
    console.error("recall auth secret provided is incorrect");
    res.status(401).send("recall auth secret provided is incorrect");
    return;
  }

  const userId = req.query.user_id as string | undefined;
  if (!userId) {
    console.error("no user_id provided");
    res.status(400).send("no user_id provided");
    return;
  }

  const userTokens = users.get(userId);
  if (!userTokens) {
    res.status(503).send(`oauth token not found for user: ${userId}. please visit /zoom/oauth`);
    return;
  }

  res.send(userTokens.accessToken);
});

app.get("/recall/obf-callback", async (req, res) => {
  if (!verifyRequestIsFromRecall(req.query.auth_token as string | undefined)) {
    console.error("recall auth secret provided is incorrect");
    res.status(401).send("recall auth secret provided is incorrect");
    return;
  }

  const userId = req.query.user_id as string | undefined;
  if (!userId) {
    console.error("no user_id provided");
    res.status(400).send("no user_id provided");
    return;
  }

  const userTokens = users.get(userId);
  if (!userTokens) {
    res.status(503).send(`oauth token not found for user: ${userId}. please visit /zoom/oauth`);
    return;
  }

  try {
    const obfToken = await generateObfToken(userTokens.accessToken);
    res.send(obfToken);
  } catch (error) {
    console.error("error fetching OBF token", error);
    res.status(500).send("error fetching OBF token");
  }
});

app.get("/recall/zak-callback", async (req, res) => {
  if (!verifyRequestIsFromRecall(req.query.auth_token as string | undefined)) {
    console.error("recall auth secret provided is incorrect");
    res.status(401).send("recall auth secret provided is incorrect");
    return;
  }

  const userId = req.query.user_id as string | undefined;
  if (!userId) {
    console.error("no user_id provided");
    res.status(400).send("no user_id provided");
    return;
  }

  const userTokens = users.get(userId);
  if (!userTokens) {
    res.status(503).send(`oauth token not found for user: ${userId}. please visit /zoom/oauth`);
    return;
  }

  try {
    const zakToken = await generateZakToken(userTokens.accessToken);
    res.send(zakToken);
  } catch (error) {
    console.error("error fetching ZAK token", error);
    res.status(500).send("error fetching ZAK token");
  }
});

app.listen(9567, "::");
