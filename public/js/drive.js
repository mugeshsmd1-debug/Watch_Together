/**
 * Google Drive Authentication & Video Picker Manager
 * Authenticates users with Google OAuth 2.0, lists their Drive video files,
 * and streams them with Range support.
 */
class GoogleDriveManager {
  constructor(options = {}) {
    this.clientId = localStorage.getItem('wt_gdrive_client_id') || '';
    this.accessToken = localStorage.getItem('wt_gdrive_access_token') || null;
    this.tokenClient = null;
    this.userEmail = localStorage.getItem('wt_gdrive_user_email') || null;
    this.onVideoSelected = options.onVideoSelected || null;
    this.onAuthChange = options.onAuthChange || null;

    this.initTokenClient();
  }

  setClientId(clientId) {
    this.clientId = clientId.trim();
    localStorage.setItem('wt_gdrive_client_id', this.clientId);
    this.initTokenClient();
  }

  initTokenClient() {
    if (!this.clientId) return;
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
      setTimeout(() => this.initTokenClient(), 500);
      return;
    }

    try {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email',
        callback: (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            this.accessToken = tokenResponse.access_token;
            localStorage.setItem('wt_gdrive_access_token', this.accessToken);
            this.fetchUserInfo();
            if (this.onAuthChange) this.onAuthChange(true);
          }
        },
        error_callback: (err) => {
          console.error('Google OAuth error:', err);
        }
      });
    } catch (e) {
      console.warn('Error initializing Google Token Client:', e);
    }
  }

  async fetchUserInfo() {
    if (!this.accessToken) return;
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      });
      if (res.ok) {
        const info = await res.json();
        this.userEmail = info.email;
        localStorage.setItem('wt_gdrive_user_email', this.userEmail);
        if (this.onAuthChange) this.onAuthChange(true, this.userEmail);
      }
    } catch (e) {
      console.warn('Could not fetch user info:', e);
    }
  }

  signIn() {
    if (!this.clientId) {
      alert('Please enter your Google Cloud OAuth Client ID first.');
      return;
    }

    if (!this.tokenClient) {
      this.initTokenClient();
    }

    if (this.tokenClient) {
      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      alert('Google Identity Services is still loading, please try again in a moment.');
    }
  }

  signOut() {
    this.accessToken = null;
    this.userEmail = null;
    localStorage.removeItem('wt_gdrive_access_token');
    localStorage.removeItem('wt_gdrive_user_email');
    if (this.onAuthChange) this.onAuthChange(false);
  }

  async listDriveVideos() {
    if (!this.accessToken) {
      throw new Error('Not authenticated with Google');
    }

    const res = await fetch(`/api/drive/files?token=${encodeURIComponent(this.accessToken)}`);
    if (!res.ok) {
      if (res.status === 401) {
        this.signOut();
        throw new Error('Session expired, please sign in again.');
      }
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to fetch Drive files');
    }

    const data = await res.json();
    return data.files || [];
  }

  getStreamUrl(fileId) {
    if (this.accessToken) {
      return `/api/drive/stream?fileId=${fileId}&token=${encodeURIComponent(this.accessToken)}`;
    }
    return `/api/drive/stream?fileId=${fileId}`;
  }
}

window.GoogleDriveManager = GoogleDriveManager;
