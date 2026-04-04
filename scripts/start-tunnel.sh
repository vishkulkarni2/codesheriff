#!/bin/bash
export PATH="/opt/homebrew/bin:$PATH"
exec cloudflared tunnel --url http://localhost:4000 --no-autoupdate 2>&1
