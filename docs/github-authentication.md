# GitHub OAuth Deep Link Implementation

Implemented deep link support for GitHub OAuth authentication to eliminate manual token copy-pasting.
The solution uses Tauri's deep-link plugin to register
a custom URL scheme (`ariana-ide://`)
that GitHub can redirect to after authentication.

1. User clicks "Continue with GitHub"
2. Browser opens for authentication
3. After auth, GitHub redirects to frontend app, which redirects directly to `ariana-ide://auth/callback?token={jwt}`
4. App automatically receives and processes the token with the backend
5. User is logged in without any manual steps

there's both frontend and backend checks to ensure deep links handling. Backend can be set to deeplink=false via
an env variable (to use in dev server, otherwise only app builds work).
If fronted or backend do not support deep links,
the user will go through the manual token input flow as a fallback.