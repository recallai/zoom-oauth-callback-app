# Zoom OAuth Server

A simple OAuth token server for Zoom integration with Recall.ai. Implemented in Typescript using Express.js.

You can run the server by:
1. installing node dependencies with `npm install`
2. running the server with `./run.sh`

To use Recall-managed OAuth credential storage, run with `./run.sh --oauth`.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /zoom/oauth` | Redirects to Zoom OAuth consent page |
| `GET /zoom/oauth-callback` | Handles OAuth callback from Zoom, stores access token |
| `GET /recall/oauth-callback` | Returns stored OAuth token to Recall |
| `GET /recall/obf-callback` | Generates and returns OBF token for a meeting |
| `GET /recall/zak-callback` | Generates and returns a ZAK token for a meeting |

## Environment Variables

- `ZOOM_CLIENT_ID` - Zoom app client ID (required)
- `ZOOM_CLIENT_SECRET` - Zoom app client secret (required unless using `--oauth`)
- `BASE_URL` - Public URL of this server (required)
- `RECALL_API_KEY` - Recall API key (required for `/launch` and when using `--oauth`)
- `RECALL_ZOOM_OAUTH_APP_ID` - Recall Zoom OAuth app ID (required when using `--oauth`)
- `RECALL_API_BASE_URL` - Recall API base URL (optional, defaults to `https://us-east-1.recall.ai`)
- `RECALL_CALLBACK_SECRET` - Secret for authenticating Recall requests (optional, defaults to "helloWorld")


Server runs on port 9567.

We recommend using [ngrok](https://ngrok.com/) to quickly get up and running for development
