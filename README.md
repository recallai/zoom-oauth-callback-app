# Zoom OAuth Server

A simple OAuth token server for Zoom integration with Recall.ai. Implemented in Golang.

You can run the server with `go run .`

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /zoom/oauth` | Redirects to Zoom OAuth consent page |
| `GET /zoom/oauth-callback` | Handles OAuth callback from Zoom, stores access token |
| `GET /recall/oauth-callback` | Returns stored OAuth token to Recall |
| `GET /recall/obf-callback` | Generates and returns OBF token for a meeting |

## Environment Variables

- `ZOOM_CLIENT_ID` - Zoom app client ID (required)
- `ZOOM_CLIENT_SECRET` - Zoom app client secret (required)
- `ZOOM_REDIRECT_URI` - OAuth callback URL (required)
- `RECALL_CALLBACK_SECRET` - Secret for authenticating Recall requests (optional, defaults to "helloWorld")


Server runs on port 9567.

We recommend using [ngrok](https://ngrok.com/) to quickly get up and running for development
