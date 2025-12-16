package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync/atomic"
	"time"
)

var oauthToken string
var refreshTokenLoopRunning = atomic.Bool{}

func main() {
	if zoomClientID == "" {
		slog.Error("missing required environment variable", "var", "ZOOM_CLIENT_ID")
		os.Exit(1)
	}
	if zoomClientSecret == "" {
		slog.Error("missing required environment variable", "var", "ZOOM_CLIENT_SECRET")
		os.Exit(1)
	}
	if zoomRedirectURI == "" {
		slog.Error("missing required environment variable", "var", "ZOOM_REDIRECT_URI", "hint", "set to http://[server address]:9567/zoom/oauth-handler")
		os.Exit(1)
	}
	if recallCallbackSecret == "" {
		slog.Warn("RECALL_CALLBACK_SECRET is not set. setting to the default value of 'helloWorld'")
		recallCallbackSecret = "helloWorld"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /zoom/oauth", oauthPage)
	mux.HandleFunc("GET /zoom/oauth-callback", oauthHandlerPage)
	mux.HandleFunc("GET /recall/oauth-callback", recallOauthCallback)
	mux.HandleFunc("GET /recall/obf-callback", recallObfCallback)
	mux.HandleFunc("GET /recall/zak-callback", recallZakCallback)

	http.ListenAndServe("[::]:9567", mux)
}

// Redirects the user to the Zoom OAuth consent page to nab an OAuth token
func oauthPage(w http.ResponseWriter, r *http.Request) {
	zoomRedirectURI := fmt.Sprintf("https://zoom.us/oauth/authorize?response_type=code&client_id=%s&redirect_uri=%s", zoomClientID, zoomRedirectURI)
	http.Redirect(w, r, zoomRedirectURI, http.StatusFound)
}

// Zoom redirects the user to this page after consenting to giving our app credentials
func oauthHandlerPage(w http.ResponseWriter, r *http.Request) {
	authCode := r.URL.Query().Get("code")
	if authCode == "" {
		slog.Error("no auth code provided for oauth handler")
		http.Error(w, "no auth code provided for oauth handler", http.StatusBadRequest)
		return
	}

	var refreshToken string
	var err error

	oauthToken, refreshToken, err = generateOAuthToken(authCode)
	if err != nil {
		slog.Error("error generating oauth token", "error", err)
		http.Error(w, "failed to generate oauth token", http.StatusInternalServerError)
		return
	}

	// access tokens expire after an hour, so we want to generate a fresh new access token before that
	go func() {
		if refreshTokenLoopRunning.Swap(true) {
			return
		}

		for {
			time.Sleep(20 * time.Minute)
			oauthToken, refreshToken, err = refreshOAuthToken(refreshToken)
			if err != nil {
				slog.Error("error refreshing oauth token", "error", err)
			}
		}

	}()

	out := fmt.Sprintf("successfully generated and stored oauth token: %s", oauthToken)
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte(out)); err != nil {
		slog.Error("error writing oauth token response", "error", err)
		return
	}
}

// Recall hits this page when launching a bot to fetch an oauth token for the user
// We also have Recall provide an "auth token" to our app in order to prevent any server on the internet from grabbing our oauth token
func recallOauthCallback(w http.ResponseWriter, r *http.Request) {
	if err := verifyRequestIsFromRecall(r); err != nil {
		slog.Error(err.Error())
		http.Error(w, "recall auth secret provided is incorrect", http.StatusUnauthorized)
		return
	}

	if oauthToken == "" {
		http.Error(w, "oauth token is not set. please visit /zoom/oauth", http.StatusServiceUnavailable)
		return
	}

	w.WriteHeader(http.StatusOK)
	// Recall expects the OAuth token to be sent as is
	if _, err := w.Write([]byte(oauthToken)); err != nil {
		slog.Error("error writing recall callback oauth token response", "error", err)
		return
	}
}

// Recall hits this page when trying to launch a bot authenticated with an OBF token
// for this implementation, we also pass the meeting_id a sa query parameter
func recallObfCallback(w http.ResponseWriter, r *http.Request) {
	if err := verifyRequestIsFromRecall(r); err != nil {
		slog.Error(err.Error())
		http.Error(w, "recall auth secret provided is incorrect", http.StatusUnauthorized)
		return
	}
	meetingID := r.URL.Query().Get("meeting_id")
	if meetingID == "" {
		slog.Error("no meeting_id provided")
		http.Error(w, "no meeting_id provided", http.StatusBadRequest)
		return
	}

	if oauthToken == "" {
		http.Error(w, "oauth token is not set. please visit /zoom/oauth", http.StatusServiceUnavailable)
		return
	}

	obfToken, err := generateObfToken(meetingID)
	if err != nil {
		slog.Error(err.Error())
		http.Error(w, "error fetching OBF token", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte(obfToken)); err != nil {
		slog.Error("error writing recall obf token response", "error", err)
		return
	}
}

// Recall hits this page when trying to launch a bot authenticated with a ZAK token
// for this implementation, we also pass the meeting_id a sa query parameter
func recallZakCallback(w http.ResponseWriter, r *http.Request) {
	if err := verifyRequestIsFromRecall(r); err != nil {
		slog.Error(err.Error())
		http.Error(w, "recall auth secret provided is incorrect", http.StatusUnauthorized)
		return
	}
	meetingID := r.URL.Query().Get("meeting_id")

	if oauthToken == "" {
		http.Error(w, "oauth token is not set. please visit /zoom/oauth", http.StatusServiceUnavailable)
		return
	}

	zakToken, err := generateZakToken(meetingID)
	if err != nil {
		slog.Error(err.Error())
		http.Error(w, "error fetching ZAK token", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	if _, err := w.Write([]byte(zakToken)); err != nil {
		slog.Error("error writing recall zak token response", "error", err)
		return
	}
}

func verifyRequestIsFromRecall(r *http.Request) error {
	recallAuthToken := r.URL.Query().Get("auth_token")
	if recallAuthToken != recallCallbackSecret {
		err := fmt.Errorf("recall auth secret provided is incorrect")
		return err
	}

	return nil
}
