# RONNY IO - Deployment Guide

## How to Host on GitHub Pages + Free Server

Since your game uses Node.js/Socket.IO (multiplayer server), you need TWO parts:

### Part 1: Host the Game Files (Frontend)
**Use GitHub Pages** - Free static hosting
1. Create a GitHub repository: https://github.com/new
2. Upload all your files EXCEPT `server.js`, `package.json`, `package-lock.json`
3. Go to Settings → Pages → Source: "main branch"
4. Your game will be at: `https://yourusername.github.io/ronnyio`

### Part 2: Host the Server (Backend)
**Use a free hosting service for Node.js:**

#### Option A: Render.com (Recommended - Free tier available)
1. Go to https://render.com and sign up
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Settings:
   - **Name**: ronnyio-server
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Free tier**: Select
5. Click "Create Web Service"
6. Your server URL will be: `https://ronnyio-server.onrender.com`

#### Option B: Railway.app (Free $5/month credits)
1. Go to https://railway.app
2. "New Project" → "Deploy from GitHub repo"
3. Select your repository
4. Railway auto-detects Node.js and deploys
5. Get your server URL from the deployment

#### Option C: Glitch.com (Free, always-on with simple setup)
1. Go to https://glitch.com
2. Click "New Project" → "Import from GitHub"
3. Paste your repo URL
4. Your server will be at: `https://your-project-name.glitch.me`

### Part 3: Connect Frontend to Server

After deploying the server, update `index.html` to connect to your server:

Find this line (around line 531):
```javascript
const socket = io();
```

Change it to:
```javascript
const socket = io('https://your-server-url.onrender.com');
```

Replace `your-server-url.onrender.com` with your actual server URL.

---

## Quick GitHub Setup

```bash
# In your project folder, run these commands:

# Initialize git repository
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - RONNY IO game"

# Create repository on GitHub, then:
git remote add origin https://github.com/yourusername/ronnyio.git
git branch -M main
git push -u origin main
```

---

## File Structure for Deployment

**GitHub Pages (Frontend):**
- index.html
- tankUpgrades.json

**Server Host (Backend):**
- server.js
- package.json
- package-lock.json
- tankUpgrades.json (needed by server too)

---

## Free Hosting Comparison

| Service | Pros | Cons |
|---------|------|------|
| **Render** | Easy, reliable, auto-deploy from GitHub | Cold starts (sleeps after 15 min inactive) |
| **Railway** | $5 free credits/month, fast | Need to monitor usage |
| **Glitch** | Simple, no sleep with boost | Limited resources |
| **Replit** | Code editor included | Can be slow |

**Recommended**: Use **Render.com** for server + **GitHub Pages** for frontend.

---

## Environment Variables (if needed)

On Render/Railway, set environment variable:
- Key: `PORT`
- Value: (leave empty, they auto-assign)

Your server.js already handles this with:
```javascript
const PORT = process.env.PORT || 13126;
```

---

## No More Tunnel Needed! 

Once deployed:
- ❌ No playit.gg tunnel
- ❌ No localhost
- ✅ Access from anywhere: `https://yourusername.github.io/ronnyio`
- ✅ Persistent server at: `https://ronnyio-server.onrender.com`
