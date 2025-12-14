package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

type oauthTokenResp struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int64  `json:"expires_in"`
	Scope        string `json:"scope"`
	APIUrl       string `json:"api_url"`
}

func generateOAuthToken(authCode string) (string, string, error) {
	// we can use the auth code returned by Zoom to ask for an oauth token
	data := url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {authCode},
		"redirect_uri": {zoomRedirectURI},
	}
	req, err := http.NewRequest("POST", "https://zoom.us/oauth/token", strings.NewReader(data.Encode()))
	if err != nil {
		return "", "", fmt.Errorf("error creating oauth token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Authorization", generateAuthorizationHeader())

	httpResp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("error fetching oauth token: %w", err)
	}
	defer func() {
		_ = httpResp.Body.Close()
	}()

	jsonResp := json.NewDecoder(httpResp.Body)

	var resp oauthTokenResp
	if err := jsonResp.Decode(&resp); err != nil {
		return "", "", fmt.Errorf("error decoding oauth token response from Zoom: %w", err)
	}

	return resp.AccessToken, resp.RefreshToken, nil
}

func refreshOAuthToken(refreshToken string) (string, string, error) {
	// we can use the auth code returned by Zoom to ask for an oauth token
	data := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
	}
	req, err := http.NewRequest("POST", "https://zoom.us/oauth/token", strings.NewReader(data.Encode()))
	if err != nil {
		return "", "", fmt.Errorf("error creating oauth token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Authorization", generateAuthorizationHeader())

	httpResp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("error fetching oauth token: %w", err)
	}
	defer func() {
		_ = httpResp.Body.Close()
	}()

	jsonResp := json.NewDecoder(httpResp.Body)

	var resp oauthTokenResp
	if err := jsonResp.Decode(&resp); err != nil {
		return "", "", fmt.Errorf("error decoding oauth token response from Zoom: %w", err)
	}

	return resp.AccessToken, resp.RefreshToken, nil
}

type tokenResp struct {
	Token string `json:"token"`
}

func generateObfToken(meetingID string) (string, error) {
	url := fmt.Sprintf("https://api.zoom.us/v2/users/me/token?type=onbehalf&meeting_id=%s", meetingID)
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	req.Header.Add("Authorization", fmt.Sprintf("Bearer %s", oauthToken))

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("error fetching oauth token: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()

	}()

	jsonDecoder := json.NewDecoder(resp.Body)
	var tokenResp tokenResp

	if err := jsonDecoder.Decode(&tokenResp); err != nil {
		return "", fmt.Errorf("failed to decode obf token response: %w", err)
	}

	return tokenResp.Token, nil
}

func ptr[T any](val T) *T {
	return &val
}

func generateAuthorizationHeader() string {
	stringToEncode := fmt.Sprintf("%s:%s", zoomClientID, zoomClientSecret)
	base64EncodedClientInfo := base64.StdEncoding.EncodeToString([]byte(stringToEncode))

	return fmt.Sprintf("Basic %s", base64EncodedClientInfo)
}
