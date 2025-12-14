package main

import (
	"os"
)

var zoomClientID = os.Getenv("ZOOM_CLIENT_ID")
var zoomClientSecret = os.Getenv("ZOOM_CLIENT_SECRET")
var zoomRedirectURI = os.Getenv("ZOOM_REDIRECT_URI")

var recallCallbackSecret = os.Getenv("RECALL_CALLBACK_SECRET")
